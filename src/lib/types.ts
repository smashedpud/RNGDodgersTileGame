export type BoardId = "board1" | "board2";

export type SquareData = Record<string, unknown>;

export type RawLeaderboardEntry = {
  "team members": string[];
  "tiles completed"?: number[];
  "current tile"?: number;
  rolls?: number[];
  board?: string;
  color?: string;
};

export type GameDataResponse = {
  boards: Record<BoardId, SquareData>;
  leaderboard: RawLeaderboardEntry[];
};
