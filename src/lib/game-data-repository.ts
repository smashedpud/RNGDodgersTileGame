import { DEFAULT_BOARDS, DEFAULT_LEADERBOARD } from "@/lib/defaultData";
import { getMongoClientPromise } from "@/lib/mongodb";
import { isValidPermission, type UserPermission } from "@/lib/permissions";
import {
  type BoardId,
  type BoardLayout,
  type BoardSpecialTile,
  type GameDataResponse,
  type GameUser,
  type RawLeaderboardEntry,
  type SquareData,
  type TileAction,
  type TileDefinition,
  type TileManagementDataResponse,
} from "@/lib/types";
import { ObjectId, type WithId } from "mongodb";

const DB_NAME = process.env.MONGODB_DB ?? "rng_dodgers";
const BOARDS_COLLECTION = "boards";
const TILES_COLLECTION = "tiles";
const LEADERBOARD_COLLECTION = "leaderboard";
const USER_PERMISSIONS_COLLECTION = "user_permissions";
const USERS_COLLECTION = "users";
let seedState: "pending" | "ready" | "readonly" = "pending";

const BOARD_IDS: BoardId[] = ["board1", "board2"];

type BoardDocument = {
  key: BoardId;
  slots: Record<string, string>;
  start?: BoardSpecialTile;
  finish?: BoardSpecialTile;
  updatedAt: Date;
  // Legacy payload retained for migration support.
  data?: SquareData;
};

type UserPermissionDocument = {
  discordId: string;
  permission: UserPermission;
  updatedAt: Date;
};

type LeaderboardDocument = RawLeaderboardEntry & {
  teamKey: string;
  updatedAt: Date;
};

type UserDocument = {
  displayName: string;
  team: string;
  discordId?: string;
  updatedAt: Date;
};

type TileDocument = {
  _id: ObjectId;
  title: string;
  subtitle?: string;
  image?: string;
  action?: TileAction;
  updatedAt: Date;
};

type TileDraft = Omit<TileDefinition, "id">;

const getTeamNameFromMembers = (members: string[]) => members.map((member) => member.trim()).join(" / ");

function toTeamKey(members: string[]) {
  return members
    .map((member) => member.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

function teamNameToKey(teamName: string) {
  const members = teamName
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
  return toTeamKey(members);
}

function toLeaderboardDocument(entry: RawLeaderboardEntry): LeaderboardDocument {
  const members = Array.isArray(entry["team members"])
    ? entry["team members"].map((member) => String(member).trim()).filter(Boolean)
    : [];

  return {
    ...entry,
    "team members": members,
    teamKey: toTeamKey(members),
    updatedAt: new Date(),
  };
}

function toRawLeaderboardEntry(doc: LeaderboardDocument): RawLeaderboardEntry {
  const { teamKey: _teamKey, updatedAt: _updatedAt, ...entry } = doc;
  return entry;
}

function buildUsersFromLeaderboard(entries: RawLeaderboardEntry[]): GameUser[] {
  const users: GameUser[] = [];
  const seenDisplayNames = new Set<string>();

  for (const entry of entries) {
    const teamMembers = Array.isArray(entry["team members"])
      ? entry["team members"].map((name) => String(name).trim()).filter(Boolean)
      : [];

    if (teamMembers.length === 0) {
      continue;
    }

    const teamName = teamMembers.join(" / ");
    for (const memberName of teamMembers) {
      if (seenDisplayNames.has(memberName)) {
        continue;
      }

      seenDisplayNames.add(memberName);
      users.push({
        displayName: memberName,
        discordId: "",
        team: teamName,
      });
    }
  }

  return users;
}

function isOutOfDiskError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: number; codeName?: string; message?: string };
  return (
    candidate.code === 14031 ||
    candidate.codeName === "OutOfDiskSpace" ||
    (typeof candidate.message === "string" && candidate.message.includes("OutOfDiskSpace"))
  );
}

function ensureWritable() {
  if (seedState !== "readonly") {
    return;
  }

  const error = new Error("Mongo is in read-only fallback due to OutOfDiskSpace.");
  (error as Error & { codeName?: string }).codeName = "OutOfDiskSpace";
  throw error;
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeSpecialTile(value: unknown): BoardSpecialTile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const title = sanitizeString(candidate.title);
  const subtitle = sanitizeString(candidate.subtitle);

  if (!title) {
    return undefined;
  }

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
  };
}

function sanitizeTileAction(value: unknown): TileAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const action = value as Record<string, unknown>;
  const kind = action.kind;

  if (kind === "reroll") {
    return { kind: "reroll" };
  }

  if (kind === "move-relative") {
    const numeric = Number(action.value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }

    return { kind: "move-relative", value: numeric };
  }

  if (kind === "move-absolute") {
    const numeric = Number(action.value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }

    return { kind: "move-absolute", value: numeric };
  }

  return undefined;
}

function toTileDraft(value: unknown): TileDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const title = sanitizeString(candidate.title);
  if (!title) {
    return null;
  }

  const subtitle = sanitizeString(candidate.subtitle);
  const image = sanitizeString(candidate.image);
  const action = sanitizeTileAction(candidate.action);

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(image ? { image } : {}),
    ...(action ? { action } : {}),
  };
}

function toPublicTile(doc: TileDocument): TileDefinition {
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    ...(doc.subtitle ? { subtitle: doc.subtitle } : {}),
    ...(doc.image ? { image: doc.image } : {}),
    ...(doc.action ? { action: doc.action } : {}),
  };
}

function toRenderableSquare(tile: TileDefinition): Record<string, unknown> {
  return {
    title: tile.title,
    ...(tile.subtitle ? { subtitle: tile.subtitle } : {}),
    ...(tile.image ? { image: tile.image } : {}),
    ...(tile.action ? { action: tile.action } : {}),
    tileId: tile.id,
  };
}

function buildDefaultSeedData() {
  const tiles: TileDocument[] = [];
  const boards: BoardDocument[] = [];

  for (const boardId of BOARD_IDS) {
    const source = DEFAULT_BOARDS[boardId] ?? {};
    const entries = Object.entries(source as Record<string, unknown>);
    const slots: Record<string, string> = {};

    const start = sanitizeSpecialTile((source as Record<string, unknown>).start);
    const finish = sanitizeSpecialTile((source as Record<string, unknown>).finish);

    for (const [key, value] of entries) {
      const tileNumber = Number(key);
      if (Number.isNaN(tileNumber)) {
        continue;
      }

      const draft = toTileDraft(value);
      if (!draft) {
        continue;
      }

      const tileId = new ObjectId();
      tiles.push({
        _id: tileId,
        ...draft,
        updatedAt: new Date(),
      });
      slots[String(tileNumber)] = tileId.toHexString();
    }

    boards.push({
      key: boardId,
      slots,
      ...(start ? { start } : {}),
      ...(finish ? { finish } : {}),
      updatedAt: new Date(),
    });
  }

  return { tiles, boards };
}

async function getDb() {
  const client = await getMongoClientPromise();
  return client.db(DB_NAME);
}

async function migrateLegacyBoardsIfNeeded() {
  const db = await getDb();
  const boardCollection = db.collection<BoardDocument>(BOARDS_COLLECTION);
  const tileCollection = db.collection<TileDocument>(TILES_COLLECTION);

  const legacyBoards = await boardCollection
    .find({ data: { $exists: true } } as Partial<BoardDocument>)
    .toArray();

  for (const legacyBoard of legacyBoards) {
    const legacyWithId = legacyBoard as WithId<BoardDocument>;
    const legacyData = legacyWithId.data;

    if (!legacyData || typeof legacyData !== "object") {
      await boardCollection.updateOne(
        { _id: legacyWithId._id },
        {
          $set: { slots: {}, updatedAt: new Date() },
          $unset: { data: "" },
        },
      );
      continue;
    }

    const source = legacyData as Record<string, unknown>;
    const slots: Record<string, string> = {};
    const tilesToInsert: TileDocument[] = [];

    Object.entries(source).forEach(([key, value]) => {
      const numericKey = Number(key);
      if (Number.isNaN(numericKey)) {
        return;
      }

      const tileDraft = toTileDraft(value);
      if (!tileDraft) {
        return;
      }

      const tileId = new ObjectId();
      tilesToInsert.push({
        _id: tileId,
        ...tileDraft,
        updatedAt: new Date(),
      });
      slots[String(numericKey)] = tileId.toHexString();
    });

    if (tilesToInsert.length > 0) {
      await tileCollection.insertMany(tilesToInsert);
    }

    const start = sanitizeSpecialTile(source.start);
    const finish = sanitizeSpecialTile(source.finish);

    await boardCollection.updateOne(
      { _id: legacyWithId._id },
      {
        $set: {
          slots,
          ...(start ? { start } : {}),
          ...(finish ? { finish } : {}),
          updatedAt: new Date(),
        },
        $unset: {
          data: "",
        },
      },
    );
  }
}

async function ensureSeeded() {
  if (seedState === "ready" || seedState === "readonly") {
    return;
  }

  const db = await getDb();
  try {
    const boardCollection = db.collection<BoardDocument>(BOARDS_COLLECTION);
    const tileCollection = db.collection<TileDocument>(TILES_COLLECTION);
    const leaderboardCollection = db.collection<LeaderboardDocument>(LEADERBOARD_COLLECTION);
    const permissionCollection = db.collection<UserPermissionDocument>(USER_PERMISSIONS_COLLECTION);
    const usersCollection = db.collection<UserDocument>(USERS_COLLECTION);

    await boardCollection.createIndex({ key: 1 }, { unique: true });
    await leaderboardCollection.createIndex({ teamKey: 1 }, { unique: true });
    await permissionCollection.createIndex({ discordId: 1 }, { unique: true });

    await migrateLegacyBoardsIfNeeded();

    const boardCount = await boardCollection.countDocuments();
    const tileCount = await tileCollection.countDocuments();

    if (boardCount === 0 || tileCount === 0) {
      const defaults = buildDefaultSeedData();
      if (tileCount === 0 && defaults.tiles.length > 0) {
        await tileCollection.insertMany(defaults.tiles);
      }

      if (boardCount === 0 && defaults.boards.length > 0) {
        await boardCollection.insertMany(defaults.boards);
      }
    }

    const leaderboardCount = await leaderboardCollection.countDocuments();

    if (leaderboardCount === 0) {
      await leaderboardCollection.insertMany(DEFAULT_LEADERBOARD.map((entry) => toLeaderboardDocument(entry)));
    } else {
      const docsMissingTeamKey = await leaderboardCollection
        .find({ teamKey: { $exists: false } })
        .toArray();

      for (const doc of docsMissingTeamKey) {
        const docWithId = doc as LeaderboardDocument & { _id: ObjectId };
        const next = toLeaderboardDocument(doc);
        await leaderboardCollection.updateOne(
          { _id: docWithId._id },
          {
            $set: {
              teamKey: next.teamKey,
              "team members": next["team members"],
              updatedAt: new Date(),
            },
          },
        );
      }
    }

    await usersCollection.dropIndex("discordId_1").catch(() => undefined);
    await usersCollection.updateMany({ discordId: "" }, { $unset: { discordId: "" } });
    await usersCollection.createIndex({ discordId: 1 }, { unique: true, sparse: true });

    const usersCount = await usersCollection.countDocuments();
    if (usersCount === 0) {
      const leaderboardEntries = await db
        .collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION)
        .find({})
        .toArray();

      const seedUsers = buildUsersFromLeaderboard(leaderboardEntries);
      if (seedUsers.length > 0) {
        const now = new Date();
        await usersCollection.insertMany(
          seedUsers.map((user) => {
            const discordId = user.discordId.trim();
            return {
              displayName: user.displayName,
              team: user.team,
              ...(discordId ? { discordId } : {}),
              updatedAt: now,
            };
          }),
        );
      }
    }

    const adminIds = (process.env.DISCORD_ADMIN_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    for (const discordId of adminIds) {
      await permissionCollection.updateOne(
        { discordId },
        {
          $set: {
            permission: "admin",
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }

    seedState = "ready";
  } catch (error) {
    if (isOutOfDiskError(error)) {
      seedState = "readonly";
      console.warn("[mongo] OutOfDiskSpace detected. Running in read-only fallback mode.");
      return;
    }

    throw error;
  }
}

export async function bootstrapGameData() {
  await ensureSeeded();
}

async function getBoardsAsLayouts(db: Awaited<ReturnType<typeof getDb>>) {
  const boardDocs = await db
    .collection<BoardDocument>(BOARDS_COLLECTION)
    .find({ key: { $in: BOARD_IDS } })
    .toArray();

  const boardByKey = new Map<BoardId, BoardLayout>();
  for (const boardId of BOARD_IDS) {
    boardByKey.set(boardId, { key: boardId, slots: {} });
  }

  for (const board of boardDocs) {
    if (!BOARD_IDS.includes(board.key)) {
      continue;
    }

    if (board.data && typeof board.data === "object") {
      continue;
    }

    boardByKey.set(board.key, {
      key: board.key,
      slots: board.slots ?? {},
      ...(board.start ? { start: board.start } : {}),
      ...(board.finish ? { finish: board.finish } : {}),
    });
  }

  return Object.fromEntries(boardByKey.entries()) as Record<BoardId, BoardLayout>;
}

export async function getGameData(): Promise<GameDataResponse> {
  await ensureSeeded();
  const db = await getDb();

  const [boardsAsLayouts, tileDocs, leaderboard, users] = await Promise.all([
    getBoardsAsLayouts(db),
    db.collection<TileDocument>(TILES_COLLECTION).find({}).toArray(),
    db.collection<LeaderboardDocument>(LEADERBOARD_COLLECTION).find({}).toArray(),
    db
      .collection<UserDocument>(USERS_COLLECTION)
      .find({}, { projection: { _id: 0, displayName: 1, discordId: 1, team: 1 } })
      .sort({ displayName: 1 })
      .toArray(),
  ]);

  const tiles = tileDocs.map((doc) => toPublicTile(doc));
  const tileById = new Map<string, TileDefinition>(tiles.map((tile) => [tile.id, tile]));

  const boards: Record<BoardId, SquareData> = {
    board1: DEFAULT_BOARDS.board1,
    board2: DEFAULT_BOARDS.board2,
  };

  for (const boardId of BOARD_IDS) {
    const layout = boardsAsLayouts[boardId];
    const nextBoard: SquareData = {};

    if (layout.start) {
      (nextBoard as Record<string, unknown>).start = layout.start;
    }
    if (layout.finish) {
      (nextBoard as Record<string, unknown>).finish = layout.finish;
    }

    Object.entries(layout.slots).forEach(([tileNumber, tileId]) => {
      const tile = tileById.get(tileId);
      if (!tile) {
        return;
      }

      (nextBoard as Record<string, unknown>)[tileNumber] = toRenderableSquare(tile);
    });

    boards[boardId] = nextBoard;
  }

  return {
    boards,
    leaderboard: leaderboard.map((doc) => toRawLeaderboardEntry(doc)),
    users: users.map((user) => ({
      displayName: user.displayName,
      discordId: user.discordId ?? "",
      team: user.team,
    })),
  };
}

export async function getTileManagementData(): Promise<TileManagementDataResponse> {
  await ensureSeeded();
  const db = await getDb();

  const [tileDocs, boards] = await Promise.all([
    db.collection<TileDocument>(TILES_COLLECTION).find({}).sort({ title: 1 }).toArray(),
    getBoardsAsLayouts(db),
  ]);

  return {
    tiles: tileDocs.map((doc) => toPublicTile(doc)),
    boards,
  };
}

export async function createTile(tile: TileDraft): Promise<TileDefinition> {
  await ensureSeeded();
  ensureWritable();
  const db = await getDb();

  const result = await db.collection<TileDocument>(TILES_COLLECTION).insertOne({
    ...tile,
    updatedAt: new Date(),
    _id: new ObjectId(),
  });

  return {
    id: result.insertedId.toHexString(),
    ...tile,
  };
}

export async function updateTile(tileId: string, tile: TileDraft): Promise<boolean> {
  await ensureSeeded();
  ensureWritable();

  let parsedId: ObjectId;
  try {
    parsedId = new ObjectId(tileId);
  } catch {
    return false;
  }

  const db = await getDb();
  const result = await db.collection<TileDocument>(TILES_COLLECTION).updateOne(
    { _id: parsedId },
    {
      $set: {
        ...tile,
        updatedAt: new Date(),
      },
    },
  );

  return result.matchedCount > 0;
}

export async function deleteTile(tileId: string): Promise<{ deleted: boolean; message?: string }> {
  await ensureSeeded();
  ensureWritable();

  let parsedId: ObjectId;
  try {
    parsedId = new ObjectId(tileId);
  } catch {
    return { deleted: false, message: "Invalid tile ID" };
  }

  const db = await getDb();
  const tileIdValue = parsedId.toHexString();

  const boards = await db
    .collection<BoardDocument>(BOARDS_COLLECTION)
    .find({}, { projection: { key: 1, slots: 1 } })
    .toArray();

  const referencingBoard = boards.find((board) =>
    Object.values(board.slots ?? {}).includes(tileIdValue),
  );

  if (referencingBoard) {
    return {
      deleted: false,
      message: `Tile is still assigned to ${referencingBoard.key}. Remove it from boards first.`,
    };
  }

  const result = await db.collection<TileDocument>(TILES_COLLECTION).deleteOne({ _id: parsedId });
  return { deleted: result.deletedCount > 0 };
}

export async function updateBoardLayout(
  boardId: BoardId,
  payload: Pick<BoardLayout, "slots" | "start" | "finish">,
): Promise<{ ok: boolean; message?: string }> {
  await ensureSeeded();
  ensureWritable();

  const db = await getDb();
  const tileIds = [...new Set(Object.values(payload.slots ?? {}))];

  if (tileIds.length > 0) {
    const objectIds = tileIds
      .map((value) => {
        try {
          return new ObjectId(value);
        } catch {
          return null;
        }
      })
      .filter((value): value is ObjectId => value != null);

    if (objectIds.length !== tileIds.length) {
      return { ok: false, message: "Board references an invalid tile ID." };
    }

    const existingCount = await db.collection<TileDocument>(TILES_COLLECTION).countDocuments({
      _id: { $in: objectIds },
    });

    if (existingCount !== tileIds.length) {
      return { ok: false, message: "Board references tiles that do not exist." };
    }
  }

  await db.collection<BoardDocument>(BOARDS_COLLECTION).updateOne(
    { key: boardId },
    {
      $set: {
        slots: payload.slots ?? {},
        ...(payload.start ? { start: payload.start } : {}),
        ...(payload.finish ? { finish: payload.finish } : {}),
        updatedAt: new Date(),
      },
      $unset: {
        ...(payload.start ? {} : { start: "" }),
        ...(payload.finish ? {} : { finish: "" }),
      },
    },
    { upsert: true },
  );

  return { ok: true };
}

export async function replaceLeaderboard(entries: RawLeaderboardEntry[]) {
  await ensureSeeded();
  ensureWritable();
  const db = await getDb();
  const collection = db.collection<LeaderboardDocument>(LEADERBOARD_COLLECTION);

  const docs = entries.map((entry) => toLeaderboardDocument(entry));
  const teamKeys = docs.map((doc) => doc.teamKey);

  if (docs.length === 0) {
    await collection.deleteMany({});
    return;
  }

  await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { teamKey: doc.teamKey },
        update: {
          $set: {
            "team members": doc["team members"],
            rolls: doc.rolls,
            board: doc.board,
            color: doc.color,
            "tiles completed": doc["tiles completed"],
            "current tile": doc["current tile"],
            updatedAt: new Date(),
          },
          $setOnInsert: {
            teamKey: doc.teamKey,
          },
        },
        upsert: true,
      },
    })),
  );

  await collection.deleteMany({ teamKey: { $nin: teamKeys } });
}

export async function getPermissionByDiscordId(discordId: string): Promise<UserPermission> {
  const db = await getDb();
  const permissionDoc = await db
    .collection<UserPermissionDocument>(USER_PERMISSIONS_COLLECTION)
    .findOne({ discordId });

  if (!permissionDoc || !isValidPermission(permissionDoc.permission)) {
    return "viewer";
  }

  return permissionDoc.permission;
}

export async function getUsers(): Promise<GameUser[]> {
  await ensureSeeded();
  const db = await getDb();

  const users = await db
    .collection<UserDocument>(USERS_COLLECTION)
    .find({}, { projection: { _id: 0, displayName: 1, discordId: 1, team: 1 } })
    .sort({ displayName: 1 })
    .toArray();

  return users.map((user) => ({
    displayName: user.displayName,
    discordId: user.discordId ?? "",
    team: user.team,
  }));
}

export async function getUserByDiscordId(discordId: string): Promise<GameUser | null> {
  await ensureSeeded();
  const db = await getDb();

  const user = await db
    .collection<UserDocument>(USERS_COLLECTION)
    .findOne(
      { discordId },
      { projection: { _id: 0, displayName: 1, discordId: 1, team: 1 } },
    );

  if (!user) {
    return null;
  }

  return {
    displayName: user.displayName,
    discordId: user.discordId ?? "",
    team: user.team,
  };
}

export async function updateTeamRolls(teamName: string, rolls: number[]): Promise<boolean> {
  await ensureSeeded();
  ensureWritable();
  const db = await getDb();
  const collection = db.collection<LeaderboardDocument>(LEADERBOARD_COLLECTION);
  const teamKey = teamNameToKey(teamName);

  const result = await collection.updateOne(
    { teamKey },
    {
      $set: {
        rolls,
        updatedAt: new Date(),
      },
    },
  );

  return result.matchedCount > 0;
}

export async function replaceUsers(users: GameUser[]) {
  await ensureSeeded();
  ensureWritable();
  const db = await getDb();
  const collection = db.collection<UserDocument>(USERS_COLLECTION);

  await collection.deleteMany({});

  if (users.length === 0) {
    return;
  }

  const now = new Date();
  await collection.insertMany(
    users.map((user) => {
      const discordId = user.discordId.trim();
      return {
        displayName: user.displayName,
        team: user.team,
        ...(discordId ? { discordId } : {}),
        updatedAt: now,
      };
    }),
  );
}
