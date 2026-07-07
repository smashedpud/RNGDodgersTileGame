import { DEFAULT_BOARDS, DEFAULT_LEADERBOARD } from "@/lib/defaultData";
import { getMongoClientPromise } from "@/lib/mongodb";
import { isValidPermission, type UserPermission } from "@/lib/permissions";
import type { BoardId, GameDataResponse, GameUser, RawLeaderboardEntry, SquareData } from "@/lib/types";

const DB_NAME = process.env.MONGODB_DB ?? "rng_dodgers";
const BOARDS_COLLECTION = "boards";
const LEADERBOARD_COLLECTION = "leaderboard";
const USER_PERMISSIONS_COLLECTION = "user_permissions";
const USERS_COLLECTION = "users";

type BoardDocument = {
  key: BoardId;
  data: SquareData;
};

type UserPermissionDocument = {
  discordId: string;
  permission: UserPermission;
  updatedAt: Date;
};

type UserDocument = {
  displayName: string;
  team: string;
  discordId?: string;
  updatedAt: Date;
};

const getTeamNameFromMembers = (members: string[]) => members.map((member) => member.trim()).join(" / ");

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

async function getDb() {
  const client = await getMongoClientPromise();
  return client.db(DB_NAME);
}

async function ensureSeeded() {
  const db = await getDb();

  const boardCount = await db.collection<BoardDocument>(BOARDS_COLLECTION).countDocuments();
  if (boardCount === 0) {
    await db.collection<BoardDocument>(BOARDS_COLLECTION).insertMany([
      { key: "board1", data: DEFAULT_BOARDS.board1 },
      { key: "board2", data: DEFAULT_BOARDS.board2 },
    ]);
  }

  const leaderboardCount = await db
    .collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION)
    .countDocuments();

  if (leaderboardCount === 0) {
    await db
      .collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION)
      .insertMany(DEFAULT_LEADERBOARD);
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
    .collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION)
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
    leaderboard,
    users: users.map((user) => ({
      displayName: user.displayName,
      discordId: user.discordId ?? "",
      team: user.team,
    })),
  };
}

export async function replaceLeaderboard(entries: RawLeaderboardEntry[]) {
  const db = await getDb();
  const collection = db.collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION);

  await collection.deleteMany({});
  if (entries.length > 0) {
    await collection.insertMany(entries);
  }
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
  const db = await getDb();
  const collection = db.collection<RawLeaderboardEntry>(LEADERBOARD_COLLECTION);
  const entries = await collection.find({}).toArray();

  const nextEntries = entries.map((entry) => {
    const members = Array.isArray(entry["team members"]) ? entry["team members"] : [];
    const normalizedTeamName = getTeamNameFromMembers(members);
    if (normalizedTeamName !== teamName) {
      return entry;
    }

    return {
      ...entry,
      rolls,
    };
  });

  const changed = nextEntries.some((entry, index) => entry !== entries[index]);
  if (!changed) {
    return false;
  }

  await collection.deleteMany({});
  if (nextEntries.length > 0) {
    await collection.insertMany(nextEntries);
  }

  return true;
}

export async function replaceUsers(users: GameUser[]) {
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
