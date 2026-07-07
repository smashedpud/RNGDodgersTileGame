export type BoardId = "board1" | "board2";

export type SquareData = Record<string, unknown>;

export type TileAction =
  | { kind: "reroll" }
  | { kind: "move-relative"; value: number }
  | { kind: "move-absolute"; value: number };

export type TileDefinition = {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  action?: TileAction;
};

export type BoardSpecialTile = {
  title: string;
  subtitle?: string;
};

export type BoardLayout = {
  key: BoardId;
  slots: Record<string, string>;
  start?: BoardSpecialTile;
  finish?: BoardSpecialTile;
};

export type TileManagementDataResponse = {
  tiles: TileDefinition[];
  boards: Record<BoardId, BoardLayout>;
};

export type RawLeaderboardEntry = {
  "team members": string[];
  "tiles completed"?: number[];
  "current tile"?: number;
  rolls?: number[];
  board?: string;
  color?: string;
};

export type GameUser = {
  displayName: string;
  discordId: string;
  team: string;
};

export type GameDataResponse = {
  boards: Record<BoardId, SquareData>;
  leaderboard: RawLeaderboardEntry[];
  users: GameUser[];
};
