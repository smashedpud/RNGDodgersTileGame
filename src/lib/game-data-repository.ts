import { DEFAULT_BOARDS, DEFAULT_LEADERBOARD } from "@/lib/defaultData";
import { getMongoClientPromise } from "@/lib/mongodb";
import type { BoardId, GameDataResponse, RawLeaderboardEntry, SquareData } from "@/lib/types";

const DB_NAME = process.env.MONGODB_DB ?? "rng_dodgers";
const BOARDS_COLLECTION = "boards";
const LEADERBOARD_COLLECTION = "leaderboard";

type BoardDocument = {
  key: BoardId;
  data: SquareData;
};

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
