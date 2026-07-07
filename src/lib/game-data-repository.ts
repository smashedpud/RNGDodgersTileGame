import { DEFAULT_BOARDS, DEFAULT_LEADERBOARD } from "@/lib/defaultData";
import { getMongoClientPromise } from "@/lib/mongodb";
import { isValidPermission, type UserPermission } from "@/lib/permissions";
import type { ObjectId } from "mongodb";
import type { BoardId, GameDataResponse, GameUser, RawLeaderboardEntry, SquareData } from "@/lib/types";

const DB_NAME = process.env.MONGODB_DB ?? "rng_dodgers";
const BOARDS_COLLECTION = "boards";
const LEADERBOARD_COLLECTION = "leaderboard";
const USER_PERMISSIONS_COLLECTION = "user_permissions";
const USERS_COLLECTION = "users";
let seedState: "pending" | "ready" | "readonly" = "pending";

type BoardDocument = {
  key: BoardId;
  data: SquareData;
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

async function getDb() {
  const client = await getMongoClientPromise();
  return client.db(DB_NAME);
}

async function ensureSeeded() {
  if (seedState === "ready" || seedState === "readonly") {
    return;
  }

  const db = await getDb();
  try {
    const boardCount = await db.collection<BoardDocument>(BOARDS_COLLECTION).countDocuments();
    if (boardCount === 0) {
      await db.collection<BoardDocument>(BOARDS_COLLECTION).insertMany([
        { key: "board1", data: DEFAULT_BOARDS.board1 },
        { key: "board2", data: DEFAULT_BOARDS.board2 },
      ]);
    }

    const leaderboardCount = await db
      .collection<LeaderboardDocument>(LEADERBOARD_COLLECTION)
      .countDocuments();

    const leaderboardCollection = db.collection<LeaderboardDocument>(LEADERBOARD_COLLECTION);
    await leaderboardCollection.createIndex({ teamKey: 1 }, { unique: true });

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

    const permissionCollection = db.collection<UserPermissionDocument>(USER_PERMISSIONS_COLLECTION);
    await permissionCollection.createIndex({ discordId: 1 }, { unique: true });

    const usersCollection = db.collection<UserDocument>(USERS_COLLECTION);
    await usersCollection.dropIndex("discordId_1").catch(() => undefined);
    // Keep compatibility with Mongo variants that do not support $ne in partial indexes.
    // We store blank IDs as missing fields and index only present IDs via sparse unique index.
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
          seedUsers.map((user) => ({
            ...user,
            updatedAt: now,
          })),
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

export async function getGameData(): Promise<GameDataResponse> {
  await ensureSeeded();
  const db = await getDb();

  const boardDocs = await db
    .collection<BoardDocument>(BOARDS_COLLECTION)
    .find({ key: { $in: ["board1", "board2"] } })
    .toArray();

  const leaderboard = await db
    .collection<LeaderboardDocument>(LEADERBOARD_COLLECTION)
    .find({})
    .toArray();

  const users = await db
    .collection<UserDocument>(USERS_COLLECTION)
    .find({}, { projection: { _id: 0, displayName: 1, discordId: 1, team: 1 } })
    .sort({ displayName: 1 })
    .toArray();

  const boards: Record<BoardId, SquareData> = {
    board1: DEFAULT_BOARDS.board1,
    board2: DEFAULT_BOARDS.board2,
  };

  for (const board of boardDocs) {
    boards[board.key] = board.data;
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
