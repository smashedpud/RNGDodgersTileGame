import leaderboardJson from "@/data/leaderboard.json";
import squaresBoard2Json from "@/data/squares-board2.json";
import squaresJson from "@/data/squares.json";
import type { BoardId, GameDataResponse, RawLeaderboardEntry, SquareData } from "@/lib/types";

export const DEFAULT_BOARDS: Record<BoardId, SquareData> = {
  board1: squaresJson as SquareData,
  board2: squaresBoard2Json as SquareData,
};

export const DEFAULT_LEADERBOARD = leaderboardJson as RawLeaderboardEntry[];

export const DEFAULT_GAME_DATA: GameDataResponse = {
  boards: DEFAULT_BOARDS,
  leaderboard: DEFAULT_LEADERBOARD,
};
