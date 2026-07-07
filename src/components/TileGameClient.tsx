"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { DEFAULT_GAME_DATA } from "@/lib/defaultData";
import type { BoardId, GameUser, RawLeaderboardEntry, SquareData } from "@/lib/types";

type Props = {
  total?: number;
  columns?: number;
  minSquare?: number;
  gap?: number;
  squareWidth?: number;
  squareHeight?: number;
};

type BoardConfig = {
  id: BoardId;
  label: string;
};

type BoardProgression = BoardConfig & {
  data: SquareData;
  bounds: BoardBounds;
};

const BOARDS: BoardConfig[] = [
  { id: "board1", label: "Board 1" },
  { id: "board2", label: "Board 2" },
];

const EMPTY_BOARD_DATA: SquareData = {};
const ACTIVE_VIEW_STORAGE_KEY = "rng-dodgers-active-view";

type PageView = BoardId | "leaderboard";

type LeaderboardEntry = {
  "team members": string[];
  "tiles completed": number[];
  "current tile": number;
  board: string;
  rolls?: number[];
  color?: string;
};

type RankedLeaderboardEntry = LeaderboardEntry & {
  sourceIndex: number;
  originalEntry: RawLeaderboardEntry;
};

type BoardBounds = {
  min: number;
  max: number;
};

type SquareAction =
  | { kind: "reroll" }
  | { kind: "move-relative"; value: number }
  | { kind: "move-absolute"; value: number };

const getNumericBoardBounds = (boardData: SquareData): BoardBounds | null => {
  const numericTiles = Object.keys(boardData)
    .map((key) => Number(key))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  if (numericTiles.length === 0) {
    return null;
  }

  const minTile = numericTiles[0] ?? 0;
  const maxTile = numericTiles[numericTiles.length - 1] ?? 0;

  return {
    min: minTile,
    max: maxTile,
  };
};

const clampTile = (value: number, bounds: BoardBounds) =>
  Math.min(bounds.max, Math.max(bounds.min, value));

const getTileAction = (tileData: Record<string, unknown> | undefined): SquareAction | null => {
  const action = tileData?.action;
  if (!action || typeof action !== "object") {
    return null;
  }

  const kind = (action as Record<string, unknown>).kind;
  if (kind === "reroll") {
    return { kind: "reroll" };
  }

  if (kind === "move-relative") {
    const value = Number((action as Record<string, unknown>).value);
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      kind: "move-relative",
      value,
    };
  }

  if (kind === "move-absolute") {
    const value = Number((action as Record<string, unknown>).value);
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      kind: "move-absolute",
      value,
    };
  }

  return null;
};

const resolveRollLanding = (
  boardData: SquareData,
  tile: number,
  originTile: number,
  bounds: BoardBounds,
  visited = new Set<number>(),
): { position: number; completedTile: number | null } => {
  const nextTile = clampTile(tile, bounds);
  if (visited.has(nextTile)) {
    return { position: nextTile, completedTile: nextTile };
  }

  visited.add(nextTile);
  const tileData = boardData[String(nextTile)] as Record<string, unknown> | undefined;
  const action = getTileAction(tileData);

  if (!action) {
    return { position: nextTile, completedTile: nextTile };
  }

  if (action.kind === "reroll") {
    return { position: originTile, completedTile: null };
  }

  if (action.kind === "move-relative") {
    return resolveRollLanding(boardData, nextTile + action.value, originTile, bounds, visited);
  }

  return resolveRollLanding(boardData, action.value, originTile, bounds, visited);
};

export function TileGameClient({
  total = 14,
  columns = 6,
  minSquare = 70,
  gap = 10,
  squareWidth = 120,
  squareHeight = 80,
}: Props) {
  const { data: session, status } = useSession();
  const localOverrideEnabled = process.env.NEXT_PUBLIC_LOCAL_AUTH_OVERRIDE === "true";
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [effectiveColumns, setEffectiveColumns] = useState(columns);
  const [squareData, setSquareData] = useState<Record<number, unknown>>({});
  const [activeBoard, setActiveBoard] = useState<PageView>(() => {
    if (typeof window === "undefined") {
      return "board1";
    }

    const savedView = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    if (savedView === "leaderboard" || BOARDS.some((board) => board.id === savedView)) {
      return savedView as PageView;
    }

    return "board1";
  });
  const [gridScale, setGridScale] = useState(1);
  const [hoveredInfo, setHoveredInfo] = useState<{
    kind: "team" | "tiles";
    text: string;
    color?: string;
  } | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [remoteData, setRemoteData] = useState(DEFAULT_GAME_DATA);
  const [draftRollsByIndex, setDraftRollsByIndex] = useState<Record<number, string>>({});
  const [saveStatus, setSaveStatus] = useState<{
    state: "idle" | "saving" | "success" | "error";
    message?: string;
  }>({ state: "idle" });
  const [userDrafts, setUserDrafts] = useState<GameUser[]>([]);
  const [userSaveStatus, setUserSaveStatus] = useState<{
    state: "idle" | "saving" | "success" | "error";
    message?: string;
  }>({ state: "idle" });

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const response = await fetch("/api/game-data", {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as typeof DEFAULT_GAME_DATA;
        if (!payload?.boards || !Array.isArray(payload.leaderboard)) {
          return;
        }

        setRemoteData(payload);
      } catch {
        // Keep local JSON fallback if API is unavailable.
      }
    };

    void loadData();

    return () => controller.abort();
  }, []);

  const boardMap = remoteData.boards;
  const boardProgressions = useMemo(() => {
    return BOARDS.flatMap((board) => {
      const data = boardMap[board.id] ?? EMPTY_BOARD_DATA;
      const bounds = getNumericBoardBounds(data);
      return bounds ? [{ ...board, data, bounds }] : [];
    });
  }, [boardMap]);

  const getBoardIndexByTile = (tile: number) =>
    boardProgressions.findIndex(({ bounds }) => tile >= bounds.min && tile <= bounds.max);

  const getBoardIndexById = (boardId?: string) => {
    const matchingIndex = boardProgressions.findIndex((board) => board.id === boardId);
    return matchingIndex >= 0 ? matchingIndex : 0;
  };

  const getProgressFromRolls = (startingBoardId: string | undefined, rolls: number[]) => {
    const startingBoardIndex = getBoardIndexById(startingBoardId);
    const startingBoard = boardProgressions[startingBoardIndex];
    if (!startingBoard) {
      return { currentTile: 0, completedTiles: [] as number[], board: BOARDS[0]?.id ?? "board1" };
    }

    let currentBoardIndex = startingBoardIndex;
    let currentBoard = startingBoard;
    let position = currentBoard.bounds.min - 1;
    const landedTiles: Array<number | null> = [];

    rolls.forEach((roll) => {
      if (!Number.isFinite(roll)) {
        return;
      }

      if (position >= currentBoard.bounds.max && currentBoardIndex < boardProgressions.length - 1) {
        currentBoardIndex += 1;
        currentBoard = boardProgressions[currentBoardIndex] as BoardProgression;
      }

      const originTile = position;
      const result = resolveRollLanding(
        currentBoard.data,
        originTile + Math.trunc(roll),
        originTile,
        currentBoard.bounds,
      );
      position = result.position;
      landedTiles.push(result.completedTile);
    });

    const completedTiles = landedTiles
      .slice(0, -1)
      .filter((tile): tile is number => tile != null);

    return {
      currentTile: position,
      completedTiles,
      board: boardProgressions[getBoardIndexByTile(position)]?.id ?? currentBoard.id,
    };
  };

  const normalizeLeaderboardEntry = (entry: RawLeaderboardEntry): LeaderboardEntry => {
    const board = BOARDS.find((candidate) => candidate.id === entry.board) ?? BOARDS[0];

    if (Array.isArray(entry.rolls)) {
      const { currentTile, completedTiles, board: currentBoardId } = getProgressFromRolls(
        entry.board,
        entry.rolls,
      );

      return {
        "team members": entry["team members"],
        "tiles completed": completedTiles,
        "current tile": currentTile,
        board: currentBoardId,
        rolls: entry.rolls,
        color: entry.color,
      };
    }

    const currentTile = typeof entry["current tile"] === "number"
      ? entry["current tile"]
      : getNumericBoardBounds(boardMap[board?.id ?? "board1"] ?? EMPTY_BOARD_DATA)?.min ?? 0;

    const resolvedBoardId =
      boardProgressions[getBoardIndexByTile(currentTile)]?.id ?? board?.id ?? "board1";

    return {
      "team members": entry["team members"],
      "tiles completed": Array.isArray(entry["tiles completed"]) ? entry["tiles completed"] : [],
      "current tile": currentTile,
      board: resolvedBoardId,
      color: entry.color,
    };
  };

  const MIN_GRID_SCALE = 1.0;
  const MAX_GRID_SCALE = 2.0;
  const GRID_SCALE_STEP = 0.1;
  const scaledMinSquare = Math.max(24, Math.round(minSquare * gridScale));
  const scaledSquareWidth = squareWidth != null ? Math.max(24, Math.round(squareWidth * gridScale)) : undefined;
  const scaledSquareHeight = squareHeight != null ? Math.max(24, Math.round(squareHeight * gridScale)) : undefined;

  const showPopup = (
    event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>,
    kind: "team" | "tiles",
    text: string,
    color?: string,
  ) => {
    const sourcePoint = "touches" in event && event.touches[0]
      ? event.touches[0]
      : event;
    const clientX = "clientX" in sourcePoint ? sourcePoint.clientX : 0;
    const clientY = "clientY" in sourcePoint ? sourcePoint.clientY : 0;

    setHoveredInfo({ kind, text, color });
    setHoverPosition({ x: clientX, y: clientY });
  };

  const clearPopup = () => {
    setHoveredInfo(null);
    setHoverPosition(null);
  };

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeBoard);
  }, [activeBoard]);

  const isLeaderboardView = activeBoard === "leaderboard";
  const activeSquaresJson =
    isLeaderboardView
      ? EMPTY_BOARD_DATA
      : boardMap[activeBoard as BoardId] ?? boardMap.board1 ?? EMPTY_BOARD_DATA;

  const tileTitleLookup = useMemo(() => {
    const lookup: Record<number, string> = {};
    const register = (source: SquareData) => {
      Object.entries(source).forEach(([key, value]) => {
        const tileNumber = Number(key);
        if (Number.isNaN(tileNumber)) return;
        const squareDataForTile = value as Record<string, unknown> | undefined;
        const title =
          typeof squareDataForTile?.title === "string" && squareDataForTile.title.trim().length > 0
            ? squareDataForTile.title
            : `Tile ${tileNumber}`;
        lookup[tileNumber] = title;
      });
    };

    BOARDS.forEach((board) => {
      register(boardMap[board.id] ?? EMPTY_BOARD_DATA);
    });
    return lookup;
  }, [boardMap]);

  const leaderboardTeams: RankedLeaderboardEntry[] = remoteData.leaderboard
    .map((entry, sourceIndex) => ({
      ...normalizeLeaderboardEntry(entry),
      sourceIndex,
      originalEntry: entry,
    }))
    .sort(
      (a, b) =>
        b["current tile"] - a["current tile"] ||
        b["tiles completed"].length - a["tiles completed"].length,
    );

  useEffect(() => {
    const nextDrafts: Record<number, string> = {};
    remoteData.leaderboard.forEach((entry, index) => {
      nextDrafts[index] = Array.isArray(entry.rolls) ? entry.rolls.join(", ") : "";
    });
    setDraftRollsByIndex(nextDrafts);
  }, [remoteData.leaderboard]);

  useEffect(() => {
    setUserDrafts(remoteData.users);
  }, [remoteData.users]);

  const parseRollsInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [] as number[];
    }

    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    const values = parts.map((part) => Number(part));
    const allValid = values.every((value) => Number.isInteger(value) && value > 0);

    if (!allValid) {
      return null;
    }

    return values;
  };

  const saveTeamRolls = async (sourceIndex: number) => {
    if (permission !== "admin") {
      return;
    }

    const parsed = parseRollsInput(draftRollsByIndex[sourceIndex] ?? "");
    if (!parsed) {
      setSaveStatus({
        state: "error",
        message: "Rolls must be positive integers separated by commas.",
      });
      return;
    }

    const nextEntries = remoteData.leaderboard.map((entry, index) => {
      if (index !== sourceIndex) {
        return entry;
      }

      return {
        ...entry,
        rolls: parsed,
      };
    });

    setSaveStatus({ state: "saving", message: "Saving rolls..." });

    try {
      const response = await fetch("/api/leaderboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entries: nextEntries }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save rolls");
      }

      setRemoteData((current) => ({
        ...current,
        leaderboard: nextEntries,
      }));
      setSaveStatus({ state: "success", message: "Rolls updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save rolls";
      setSaveStatus({ state: "error", message });
    }
  };

  const saveUsers = async () => {
    if (!isAdmin) {
      return;
    }

    const normalizedUsers = userDrafts.map((user) => ({
      displayName: user.displayName.trim(),
      discordId: user.discordId.trim(),
      team: user.team.trim(),
    }));

    const hasInvalid = normalizedUsers.some(
      (user) => !user.displayName || !user.team,
    );

    if (hasInvalid) {
      setUserSaveStatus({
        state: "error",
        message: "Each user needs display name and team.",
      });
      return;
    }

    const nonEmptyIds = normalizedUsers
      .map((user) => user.discordId)
      .filter((discordId) => discordId.length > 0);
    const idSet = new Set(nonEmptyIds);
    if (idSet.size !== nonEmptyIds.length) {
      setUserSaveStatus({
        state: "error",
        message: "Discord IDs must be unique when provided.",
      });
      return;
    }

    setUserSaveStatus({ state: "saving", message: "Saving users..." });

    try {
      const response = await fetch("/api/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ users: normalizedUsers }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save users");
      }

      setRemoteData((current) => ({
        ...current,
        users: normalizedUsers,
      }));
      setUserSaveStatus({ state: "success", message: "Users updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save users";
      setUserSaveStatus({ state: "error", message });
    }
  };

  const updateUserDraft = (index: number, field: keyof GameUser, value: string) => {
    setUserDrafts((current) =>
      current.map((user, currentIndex) =>
        currentIndex === index
          ? {
              ...user,
              [field]: value,
            }
          : user,
      ),
    );
  };

  const removeUserDraft = (index: number) => {
    setUserDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const addUserDraft = () => {
    setUserDrafts((current) => [...current, { displayName: "", discordId: "", team: "" }]);
  };

  const teamsByCurrentTile = useMemo(() => {
    const groups = new Map<number, LeaderboardEntry[]>();
    leaderboardTeams
      .filter((team) => activeBoard === "leaderboard" || team.board === activeBoard)
      .forEach((team) => {
        const existing = groups.get(team["current tile"]) ?? [];
        existing.push(team);
        groups.set(team["current tile"], existing);
      });
    return groups;
  }, [activeBoard, leaderboardTeams]);

  const boardLabelLookup = useMemo(
    () => Object.fromEntries(BOARDS.map((board, index) => [board.id, String(index + 1)])),
    [],
  );
  const permission = session?.user?.permission ?? "viewer";
  const sessionLabel = session?.user?.name ?? session?.user?.discordId ?? "Guest";
  const isAdmin = permission === "admin";

  const showCurrentBoardColumn = leaderboardTeams.some((team) => team.board !== BOARDS[0]?.id);
  const canDecreaseGrid = gridScale > MIN_GRID_SCALE;
  const canIncreaseGrid = gridScale < MAX_GRID_SCALE;
  const gridScalePercent = Math.round(gridScale * 100);
  const jsonSquareKeys = Object.keys(activeSquaresJson)
    .map((key) => Number(key))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  const placeholderImage =
    "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22280%22%20height%3D%22280%22%20viewBox%3D%220%200%20280%20280%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%22280%22%20height%3D%22280%22%20fill%3D%22%234a764a%22/%3E%3Ctext%20x%3D%22140%22%20y%3D%22150%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2220%22%20fill%3D%22%23fff%22%3EImage%3C/text%3E%3C/svg%3E";

  useEffect(() => {
    if (isLeaderboardView) {
      return;
    }

    let el = gridRef.current;
    if (!el) {
      el = document.querySelector(".grid") as HTMLDivElement | null;
      if (!el) {
        return;
      }
    }

    const compute = (measuredWidth: number) => {
      const elStyle = getComputedStyle(el);
      const gapPx = parseFloat(elStyle.getPropertyValue("--gap")) || gap;
      const minPx = scaledMinSquare;

      const viewportPadding = 40;
      const winWidth = window.innerWidth;
      const viewportAvailable = Math.max(100, winWidth - viewportPadding);
      let availableWidth = measuredWidth;
      if (measuredWidth < 50) {
        availableWidth = viewportAvailable;
      } else {
        availableWidth = Math.min(measuredWidth, viewportAvailable);
      }

      let chosen = 1;
      let computedWidth: number;

      if (scaledSquareWidth != null) {
        computedWidth = Math.max(minPx, scaledSquareWidth);
        let fit = 1;
        for (let c = columns; c >= 1; c -= 1) {
          if (c * computedWidth + gapPx * (c - 1) <= availableWidth) {
            fit = c;
            break;
          }
        }
        chosen = fit;
      } else {
        let rawSize = availableWidth;
        for (let c = columns; c >= 1; c -= 1) {
          const sq = (availableWidth - gapPx * (c - 1)) / c;
          if (sq >= minPx) {
            chosen = c;
            rawSize = sq;
            break;
          }
        }

        if (chosen === 1) rawSize = availableWidth;

        const rootStyle = getComputedStyle(document.documentElement);
        const maxPx = parseFloat(rootStyle.getPropertyValue("--max-square")) || minPx * 2;
        computedWidth = Math.max(minPx, Math.min(rawSize, maxPx));
      }

      const computedHeight = scaledSquareHeight != null ? scaledSquareHeight : computedWidth;

      el.style.setProperty("--computed-width", `${computedWidth}px`);
      el.style.setProperty("--computed-height", `${computedHeight}px`);
      const gridWidth = chosen * computedWidth + (chosen - 1) * gapPx;
      el.style.setProperty("--grid-width", `${gridWidth}px`);

      setEffectiveColumns(chosen);
    };

    const measureTarget = document.documentElement;
    const ro = new ResizeObserver(() => {
      compute(window.innerWidth);
    });

    ro.observe(measureTarget);

    const onWindowResize = () => {
      compute(window.innerWidth);
    };

    window.addEventListener("resize", onWindowResize);
    onWindowResize();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [columns, gap, isLeaderboardView, scaledMinSquare, scaledSquareHeight, scaledSquareWidth]);

  useEffect(() => {
    const map: Record<number, unknown> = {};
    Object.keys(activeSquaresJson).forEach((k) => {
      const n = Number(k);
      if (!Number.isNaN(n)) map[n] = activeSquaresJson[k];
    });
    setSquareData(map);
  }, [activeBoard, activeSquaresJson]);

  const boardCells = [
    ...((activeSquaresJson.start
      ? [{
          kind: "special" as const,
          id: "start",
          title: (activeSquaresJson.start as Record<string, string>)?.title || "Start",
          subtitle: (activeSquaresJson.start as Record<string, string>)?.subtitle,
        }]
      : []) as Array<{ kind: "special"; id: string; title: string; subtitle?: string }>),
    ...jsonSquareKeys.map((value) => ({
      kind: "number" as const,
      value,
    })),
    ...((activeSquaresJson.finish
      ? [{
          kind: "special" as const,
          id: "finish",
          title: (activeSquaresJson.finish as Record<string, string>)?.title || "Finish",
          subtitle: (activeSquaresJson.finish as Record<string, string>)?.subtitle,
        }]
      : []) as Array<{ kind: "special"; id: string; title: string; subtitle?: string }>),
  ];

  const rows = Math.ceil(boardCells.length / effectiveColumns);

  const getCompletedTileTitles = (tiles: number[]) => {
    if (tiles.length === 0) {
      return "No tiles completed yet";
    }

    const tileCounts = new Map<number, number>();
    const orderedTiles: number[] = [];

    tiles.forEach((tile) => {
      if (!tileCounts.has(tile)) {
        orderedTiles.push(tile);
      }

      tileCounts.set(tile, (tileCounts.get(tile) ?? 0) + 1);
    });

    return orderedTiles
      .map((tile) => {
        const title = tileTitleLookup[tile];
        const count = tileCounts.get(tile) ?? 1;
        const label = title ? `${title}` : `Tile ${tile}`;
        return count > 1 ? `${label} (${count})` : label;
      })
      .join("\n");
  };

  const getCurrentTileTitle = (tile: number) => tileTitleLookup[tile] ?? `Tile ${tile}`;

  useEffect(() => {
    if (!hoveredInfo) {
      return;
    }

    const timeoutId = window.setTimeout(() => setHoveredInfo(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [hoveredInfo]);

  const gridRows = Array.from({ length: rows }).map((_, rowIndex) => {
    const rowStart = rowIndex * effectiveColumns;
    const rowEnd = Math.min(boardCells.length - 1, rowStart + effectiveColumns - 1);
    const values = boardCells.slice(rowStart, rowEnd + 1);
    const placeholderCount = Math.max(0, effectiveColumns - values.length);
    return { values, placeholderCount, rowIndex };
  });

  return (
    <div
      className="app-shell"
      style={{ ["--logo-url" as string]: "url(/icon.webp)" } as React.CSSProperties}
      data-total={total}
    >
      <header className="page-header">
        <h1 className="page-title">
          RNG Dodgers - <span className="title-accent">Tile Game</span> - 2 Man
        </h1>
        <div className="header-controls">
          <div className="auth-controls">
            {status === "authenticated" ? (
              <>
                <span className="auth-badge">
                  Signed in as {sessionLabel} ({permission})
                </span>
                <button
                  type="button"
                  className="board-button"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="board-button"
                  onClick={() => signIn("discord")}
                >
                  Sign in with Discord
                </button>
                {localOverrideEnabled ? (
                  <button
                    type="button"
                    className="board-button"
                    onClick={() =>
                      signIn("local-override", {
                        discordId:
                          process.env.NEXT_PUBLIC_LOCAL_AUTH_OVERRIDE_DISCORD_ID ?? "local-admin",
                        displayName:
                          process.env.NEXT_PUBLIC_LOCAL_AUTH_OVERRIDE_NAME ?? "Local Admin",
                        callbackUrl: "/",
                      })
                    }
                  >
                    Local Admin Login
                  </button>
                ) : null}
              </>
            )}
          </div>
          <div className="board-menu">
            {BOARDS.map((board) => (
              <button
                key={board.id}
                type="button"
                className={activeBoard === board.id ? "board-button active" : "board-button"}
                onClick={() => setActiveBoard(board.id)}
              >
                {board.label}
              </button>
            ))}
            <button
              type="button"
              className={activeBoard === "leaderboard" ? "board-button active" : "board-button"}
              onClick={() => setActiveBoard("leaderboard")}
            >
              Leaderboard
            </button>
          </div>
          {!isLeaderboardView ? (
            <div className="grid-size-controls" aria-label="Grid size controls">
              <button
                type="button"
                className="size-button"
                onClick={() =>
                  setGridScale((current) =>
                    Math.max(MIN_GRID_SCALE, Number((current - GRID_SCALE_STEP).toFixed(2))),
                  )
                }
                disabled={!canDecreaseGrid}
                aria-label="Decrease grid size"
              >
                -
              </button>
              <span className="size-value">{gridScalePercent}%</span>
              <button
                type="button"
                className="size-button"
                onClick={() =>
                  setGridScale((current) =>
                    Math.min(MAX_GRID_SCALE, Number((current + GRID_SCALE_STEP).toFixed(2))),
                  )
                }
                disabled={!canIncreaseGrid}
                aria-label="Increase grid size"
              >
                +
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {hoveredInfo && hoverPosition ? (
        <div
          className={`leaderboard-popup ${hoveredInfo.kind === "team" ? "team" : "tiles"}`}
          style={{
            left: hoverPosition.x + 12,
            top: hoverPosition.y + 12,
            borderLeftColor:
              hoveredInfo.color || (hoveredInfo.kind === "team" ? "#38bdf8" : "#fb923c"),
          }}
        >
          {hoveredInfo.text}
        </div>
      ) : null}

      {isLeaderboardView ? (
        <>
        <div className="leaderboard-card">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Team</th>
                {showCurrentBoardColumn ? <th>Current Board</th> : null}
                <th>Current Tile</th>
                <th>Total Tiles Completed</th>
                {isAdmin ? <th>Rolls</th> : null}
              </tr>
            </thead>
            <tbody>
              {isAdmin && saveStatus.state !== "idle" ? (
                <tr>
                  <td colSpan={showCurrentBoardColumn ? 5 : 4}>
                    <div
                      className={`roll-save-status ${saveStatus.state === "error" ? "error" : "success"}`}
                    >
                      {saveStatus.message}
                    </div>
                  </td>
                </tr>
              ) : null}
              {leaderboardTeams.map((team, index) => (
                <tr key={`${team["team members"].join("-")}-${index}`}>
                  <td className="leaderboard-team-pill">
                    <span
                      className="leaderboard-team-color"
                      style={{ backgroundColor: team.color || "#6b7280" }}
                    />
                    {team["team members"].join(", ")}
                  </td>
                  {showCurrentBoardColumn ? (
                    <td>{boardLabelLookup[team.board as BoardId] ?? team.board}</td>
                  ) : null}
                  <td>
                    <button
                      type="button"
                      className="leaderboard-tile-count"
                      onMouseEnter={(event) =>
                        showPopup(event, "tiles", getCurrentTileTitle(team["current tile"]), team.color)
                      }
                      onMouseMove={(event) =>
                        setHoverPosition({ x: event.clientX, y: event.clientY })
                      }
                      onMouseLeave={clearPopup}
                      onClick={(event) =>
                        showPopup(event, "tiles", getCurrentTileTitle(team["current tile"]), team.color)
                      }
                    >
                      {team["current tile"]}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="leaderboard-tile-count"
                      onMouseEnter={(event) =>
                        showPopup(
                          event,
                          "tiles",
                          getCompletedTileTitles(team["tiles completed"]),
                          team.color,
                        )
                      }
                      onMouseMove={(event) =>
                        setHoverPosition({ x: event.clientX, y: event.clientY })
                      }
                      onMouseLeave={clearPopup}
                      onClick={(event) =>
                        showPopup(
                          event,
                          "tiles",
                          getCompletedTileTitles(team["tiles completed"]),
                          team.color,
                        )
                      }
                    >
                      {team["tiles completed"].length}
                    </button>
                  </td>
                  {isAdmin ? (
                    <td>
                      <div className="roll-editor">
                        <input
                          type="text"
                          className="roll-editor-input"
                          value={draftRollsByIndex[team.sourceIndex] ?? ""}
                          onChange={(event) =>
                            setDraftRollsByIndex((current) => ({
                              ...current,
                              [team.sourceIndex]: event.target.value,
                            }))
                          }
                          aria-label={`Rolls for ${team["team members"].join(", ")}`}
                        />
                        <button
                          type="button"
                          className="roll-save-button"
                          disabled={saveStatus.state === "saving"}
                          onClick={() => {
                            void saveTeamRolls(team.sourceIndex);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin ? (
          <div className="leaderboard-card user-admin-card">
            <div className="user-admin-header">
              <h2 className="user-admin-title">User Team Mapping</h2>
              <div className="user-admin-actions">
                <button type="button" className="roll-save-button" onClick={addUserDraft}>Add User</button>
                <button
                  type="button"
                  className="roll-save-button"
                  disabled={userSaveStatus.state === "saving"}
                  onClick={() => {
                    void saveUsers();
                  }}
                >
                  Save Users
                </button>
              </div>
            </div>

            {userSaveStatus.state !== "idle" ? (
              <div className={`roll-save-status ${userSaveStatus.state === "error" ? "error" : "success"}`}>
                {userSaveStatus.message}
              </div>
            ) : null}

            <div className="user-admin-table-wrap">
              <table className="leaderboard-table user-admin-table">
                <thead>
                  <tr>
                    <th>Display Name</th>
                    <th>Discord ID</th>
                    <th>Team</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {userDrafts.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No users configured yet.</td>
                    </tr>
                  ) : (
                    userDrafts.map((user, index) => (
                      <tr key={`${user.discordId}-${index}`}>
                        <td>
                          <input
                            type="text"
                            className="roll-editor-input"
                            value={user.displayName}
                            onChange={(event) => updateUserDraft(index, "displayName", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="roll-editor-input"
                            value={user.discordId}
                            onChange={(event) => updateUserDraft(index, "discordId", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="roll-editor-input"
                            value={user.team}
                            onChange={(event) => updateUserDraft(index, "team", event.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="roll-save-button user-delete-button"
                            onClick={() => removeUserDraft(index)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        </>
      ) : (
        <div
          ref={gridRef}
          className="grid"
          style={
            {
              ["--columns" as string]: String(effectiveColumns),
              ["--columnsMinusOne" as string]: String(Math.max(0, effectiveColumns - 1)),
              ["--computed-height" as string]:
                squareHeight != null ? `${squareHeight}px` : undefined,
            } as React.CSSProperties
          }
        >
          {gridRows.map(({ values, placeholderCount, rowIndex }) => (
            <div className={`row ${rowIndex % 2 === 1 ? "reverse" : ""}`} key={rowIndex}>
              {values.map((cell, idx) => {
                const resolveImageUrl = (src?: string) => {
                  if (!src) return undefined;
                  if (src.includes("oldschool.runescape.wiki")) {
                    return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=png`;
                  }
                  return src;
                };

                if (cell.kind === "special") {
                  const isStart = cell.id === "start";
                  const isFinish = cell.id === "finish";

                  return (
                    <div
                      key={cell.id}
                      className={`square special-square ${isStart ? "start-square" : ""} ${
                        isFinish ? "finish-square" : ""
                      }`}
                    >
                      <div className="meta">
                        <div className="square-title">{cell.title}</div>
                        {cell.subtitle && <div className="square-subtitle">{cell.subtitle}</div>}
                      </div>

                      {idx < values.length - 1 && (
                        <div className={`arrow ${rowIndex % 2 === 0 ? "right" : "left"}`} />
                      )}
                      {idx === values.length - 1 && rowIndex < rows - 1 && <div className="arrow down" />}
                    </div>
                  );
                }

                const val = cell.value;
                const info = squareData[val] as Record<string, string> | undefined;
                const teamsOnThisTile = teamsByCurrentTile.get(val) ?? [];

                return (
                  <div key={val} className={`square ${info ? "has-info" : ""}`}>
                    {info ? (
                      <div className="meta">
                        {info.title && <div className="square-title">{info.title}</div>}
                        {info.subtitle && <div className="square-subtitle">{info.subtitle}</div>}
                        {info.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveImageUrl(info.image)}
                            alt={info.title || ""}
                            className="square-image"
                            loading="eager"
                            decoding="async"
                            crossOrigin="anonymous"
                            onError={(event) => {
                              const target = event.currentTarget;
                              const fallbackImage = resolveImageUrl(info.image) ?? placeholderImage;
                              if (!target.src.includes("images.weserv.nl")) {
                                target.src = fallbackImage;
                              } else if (target.src !== placeholderImage) {
                                target.src = placeholderImage;
                              }
                            }}
                          />
                        )}
                      </div>
                    ) : null}

                    <div className="square-number">[{val}]</div>

                    {teamsOnThisTile.length > 0 && (
                      <div className="tile-team-markers" aria-label={`Teams on tile ${val}`}>
                        {teamsOnThisTile.map((team, markerIndex) => (
                          <span
                            key={`${team["team members"].join("-")}-${markerIndex}`}
                            className="tile-team-marker"
                            style={{ backgroundColor: team.color || "#ffffff" }}
                            onMouseEnter={(event) =>
                              showPopup(event, "team", team["team members"].join(", "), team.color)
                            }
                            onMouseMove={(event) =>
                              setHoverPosition({ x: event.clientX, y: event.clientY })
                            }
                            onMouseLeave={clearPopup}
                            onClick={(event) =>
                              showPopup(event, "team", team["team members"].join(", "), team.color)
                            }
                          />
                        ))}
                      </div>
                    )}

                    {idx < values.length - 1 && (
                      <div className={`arrow ${rowIndex % 2 === 0 ? "right" : "left"}`} />
                    )}
                    {idx === values.length - 1 && rowIndex < rows - 1 && <div className="arrow down" />}
                  </div>
                );
              })}
              {Array.from({ length: placeholderCount }).map((_, placeholderIdx) => (
                <div key={`placeholder-${rowIndex}-${placeholderIdx}`} className="square placeholder" />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
