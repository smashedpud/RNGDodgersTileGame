import React, { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import squaresJson from "./data/squares.json";
import squaresBoard2Json from "./data/squares-board2.json";
import leaderboardJson from "./data/leaderboard.json";
import logoImage from "./icon.webp";

type Props = {
  total?: number;
  columns?: number;
  minSquare?: number;
  gap?: number;
  squareWidth?: number;
  squareHeight?: number;
};

type PageView = "board1" | "board2" | "leaderboard";

type LeaderboardEntry = {
  "team members": string[];
  "tiles completed": number[];
  "current tile": number;
  color?: string;
};

export function App({ total = 14, columns = 6, minSquare = 70, gap = 10, squareWidth = 120, squareHeight = 80 }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [effectiveColumns, setEffectiveColumns] = useState(columns);
  const [squareData, setSquareData] = useState<Record<number, any>>({});
  const [activeBoard, setActiveBoard] = useState<PageView>("board1");
  const [gridScale, setGridScale] = useState(1);
  const [hoveredInfo, setHoveredInfo] = useState<{ kind: "team" | "tiles"; text: string; color?: string } | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

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

  const boardMap = {
    board1: squaresJson,
    board2: squaresBoard2Json,
  } as const;

  const activeSquaresJson = boardMap[activeBoard as Exclude<PageView, "leaderboard">] ?? squaresJson;
  const tileTitleLookup = useMemo(() => {
    const lookup: Record<number, string> = {};
    const register = (source: Record<string, unknown>) => {
      Object.entries(source).forEach(([key, value]) => {
        const tileNumber = Number(key);
        if (Number.isNaN(tileNumber)) return;
        const squareDataForTile = value as Record<string, unknown> | undefined;
        const title = typeof squareDataForTile?.title === "string" && squareDataForTile.title.trim().length > 0
          ? squareDataForTile.title
          : `Tile ${tileNumber}`;
        lookup[tileNumber] = title;
      });
    };

    register(squaresJson as Record<string, unknown>);
    register(squaresBoard2Json as Record<string, unknown>);
    return lookup;
  }, []);
  const leaderboardTeams = [...(leaderboardJson as LeaderboardEntry[])].sort(
    (a, b) => b["current tile"] - a["current tile"] || b["tiles completed"].length - a["tiles completed"].length,
  );
  const teamsByCurrentTile = useMemo(() => {
    const groups = new Map<number, LeaderboardEntry[]>();
    leaderboardTeams.forEach((team) => {
      const existing = groups.get(team["current tile"]) ?? [];
      existing.push(team);
      groups.set(team["current tile"], existing);
    });
    return groups;
  }, [leaderboardTeams]);
  const isLeaderboardView = activeBoard === "leaderboard";
  const canDecreaseGrid = gridScale > MIN_GRID_SCALE;
  const canIncreaseGrid = gridScale < MAX_GRID_SCALE;
  const gridScalePercent = Math.round(gridScale * 100);
  const jsonSquareKeys = Object.keys(activeSquaresJson)
    .map((key) => Number(key))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  const placeholderImage =
    'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22280%22%20height%3D%22280%22%20viewBox%3D%220%200%20280%20280%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%22280%22%20height%3D%22280%22%20fill%3D%22%234a764a%22/%3E%3Ctext%20x%3D%22140%22%20y%3D%22150%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2220%22%20fill%3D%22%23fff%22%3EImage%3C/text%3E%3C/svg%3E';

  useEffect(() => {
    let el = gridRef.current;
    if (!el) {
      el = document.querySelector('.grid') as HTMLDivElement | null;
      if (!el) {
        return;
      }
    }
    const compute = (measuredWidth: number) => {
      const elStyle = getComputedStyle(el);
      const gapPx = parseFloat(elStyle.getPropertyValue("--gap")) || gap;
      const minPx = scaledMinSquare;

      // Prefer the actual measured container width, but cap it to the viewport
      // to allow the grid to shrink when the window becomes smaller. If the
      // measured width is clearly invalid (very small), fall back to viewport.
      const viewportPadding = 40; // leave small padding
      const winWidth = window.innerWidth;
      const viewportAvailable = Math.max(100, winWidth - viewportPadding);
      let availableWidth = measuredWidth;
      if (measuredWidth < 50) {
        availableWidth = viewportAvailable; // measurement likely not ready
      } else {
        availableWidth = Math.min(measuredWidth, viewportAvailable);
      }

      // Debugging: log values to diagnose single-column issue
      let chosen = 1;
      let rawWidth = availableWidth; // fallback width
      let computedWidth: number;

      if (scaledSquareWidth != null) {
        computedWidth = Math.max(minPx, scaledSquareWidth);
        let fit = 1;
        for (let c = columns; c >= 1; c--) {
          if (c * computedWidth + gapPx * (c - 1) <= availableWidth) {
            fit = c;
            break;
          }
        }
        chosen = fit;
        rawWidth = computedWidth;
      } else {
        let rawSize = availableWidth; // fallback
        for (let c = columns; c >= 1; c--) {
          const sq = (availableWidth - gapPx * (c - 1)) / c;
          if (sq >= minPx) {
            chosen = c;
            rawSize = sq;
            break;
          }
        }

        // if none met minPx, use 1 column raw size
        if (chosen === 1) rawSize = (availableWidth - 0) / 1;

        // read max from CSS var if present
        const rootStyle = getComputedStyle(document.documentElement);
        const maxPx = parseFloat(rootStyle.getPropertyValue("--max-square")) || minPx * 2;
        computedWidth = Math.max(minPx, Math.min(rawSize, maxPx));
      }

      const computedHeight = scaledSquareHeight != null ? scaledSquareHeight : computedWidth;

      // set CSS vars on grid element so layout uses exact pixels
      el.style.setProperty("--computed-width", `${computedWidth}px`);
      el.style.setProperty("--computed-height", `${computedHeight}px`);
      const gridWidth = chosen * computedWidth + (chosen - 1) * gapPx;
      el.style.setProperty("--grid-width", `${gridWidth}px`);

      setEffectiveColumns(chosen);
    };

    // Observe the viewport (documentElement) so the grid follows window resizing.
    const measureTarget = document.documentElement;
    const ro = new ResizeObserver(() => {
      // Use the viewport width as the authoritative available width.
      compute(window.innerWidth);
    });

    ro.observe(measureTarget);

    const onWindowResize = () => {
      compute(window.innerWidth);
    };

    window.addEventListener("resize", onWindowResize);
    // initial compute using parent width
    onWindowResize();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [columns, gap, scaledMinSquare, scaledSquareHeight, scaledSquareWidth]);

  // load square details from imported JSON (bundled at build time)
  useEffect(() => {
    try {
      const map: Record<number, any> = {};
      Object.keys(activeSquaresJson).forEach((k) => {
        const n = Number(k);
        if (!Number.isNaN(n)) map[n] = (activeSquaresJson as any)[k];
      });
      setSquareData(map);
    } catch (err) {
    }
  }, [activeBoard, activeSquaresJson]);

  const boardCells = [
    ...(activeBoard === "board1"
      ? [{
          kind: "special" as const,
          id: "start",
          title: (activeSquaresJson as Record<string, any>).start?.title || "Start",
          subtitle: (activeSquaresJson as Record<string, any>).start?.subtitle,
        }]
      : []),
    ...jsonSquareKeys.map((value) => ({
      kind: "number" as const,
      value,
    })),
    ...(activeBoard === "board2"
      ? [{
          kind: "special" as const,
          id: "finish",
          title: (activeSquaresJson as Record<string, any>).finish?.title || "Finish",
          subtitle: (activeSquaresJson as Record<string, any>).finish?.subtitle,
        }]
      : []),
  ];
  const rows = Math.ceil(boardCells.length / effectiveColumns);

  const getCompletedTileTitles = (tiles: number[]) => {
    if (tiles.length === 0) {
      return "No tiles completed yet";
    }

    return tiles
      .map((tile) => {
        const title = tileTitleLookup[tile];
        return title ? `${tile}: ${title}` : `Tile ${tile}`;
      })
      .join("\n");
  };

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
      style={{ ["--logo-url" as any]: `url(${logoImage})` } as React.CSSProperties}
    >
      <header className="page-header">
        <h1 className="page-title">
            <>
              RNG Dodgers - <span className="title-accent">Tile Game</span> - 2 Man
            </>
        </h1>
        <div className="header-controls">
          <div className="board-menu">
            <button
              type="button"
              className={activeBoard === "board1" ? "board-button active" : "board-button"}
              onClick={() => setActiveBoard("board1")}
            >
              Board 1
            </button>
            <button
              type="button"
              className={activeBoard === "board2" ? "board-button active" : "board-button"}
              onClick={() => setActiveBoard("board2")}
            >
              Board 2
            </button>
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
                onClick={() => setGridScale((current) => Math.max(MIN_GRID_SCALE, Number((current - GRID_SCALE_STEP).toFixed(2))))}
                disabled={!canDecreaseGrid}
                aria-label="Decrease grid size"
              >
                -
              </button>
              <span className="size-value">{gridScalePercent}%</span>
              <button
                type="button"
                className="size-button"
                onClick={() => setGridScale((current) => Math.min(MAX_GRID_SCALE, Number((current + GRID_SCALE_STEP).toFixed(2))))}
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
            borderLeftColor: hoveredInfo.color || (hoveredInfo.kind === "team" ? "#38bdf8" : "#fb923c"),
          }}
        >
          {hoveredInfo.text}
        </div>
      ) : null}

      {isLeaderboardView ? (
        <div className="leaderboard-card">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Current Tile</th>
                <th>Total Tiles Completed</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardTeams.map((team, index) => (
                <tr key={`${team["team members"].join("-")}-${index}`}>
                  <td className="leaderboard-team-pill">
                      <span
                        className="leaderboard-team-color"
                        style={{ backgroundColor: team.color || "#6b7280" }}
                      />
                      {team["team members"].join(", ")}
                  </td>
                  <td>{team["current tile"]}</td>
                  <td>
                    <button
                      type="button"
                      className="leaderboard-tile-count"
                      onMouseEnter={(event) => showPopup(event, "tiles", getCompletedTileTitles(team["tiles completed"]), team.color)}
                      onMouseMove={(event) => setHoverPosition({ x: event.clientX, y: event.clientY })}
                      onMouseLeave={clearPopup}
                      onClick={(event) => showPopup(event, "tiles", getCompletedTileTitles(team["tiles completed"]), team.color)}
                    >
                      {team["tiles completed"].length}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid"
          style={
            {
              ["--columns" as any]: String(effectiveColumns),
              ["--columnsMinusOne" as any]: String(Math.max(0, effectiveColumns - 1)),
              ["--computed-height" as any]: squareHeight != null ? `${squareHeight}px` : undefined,
            } as React.CSSProperties
          }
        >
          {gridRows.map(({ values, placeholderCount, rowIndex }) => (
            <div
              className={`row ${rowIndex % 2 === 1 ? "reverse" : ""}`}
              key={rowIndex}
            >
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
                      className={`square special-square ${isStart ? "start-square" : ""} ${isFinish ? "finish-square" : ""}`}
                    >
                      <div className="meta">
                        <div className="square-title">{cell.title}</div>
                        {cell.subtitle && <div className="square-subtitle">{cell.subtitle}</div>}
                      </div>

                      {idx < values.length - 1 && (
                        <div className={`arrow ${rowIndex % 2 === 0 ? "right" : "left"}`} />
                      )}
                      {idx === values.length - 1 && rowIndex < rows - 1 && (
                        <div className="arrow down" />
                      )}
                    </div>
                  );
                }

                const val = cell.value;
                const info = squareData[val];
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
                            onMouseEnter={(event) => showPopup(event, "team", team["team members"].join(", "), team.color)}
                            onMouseMove={(event) => setHoverPosition({ x: event.clientX, y: event.clientY })}
                            onMouseLeave={clearPopup}
                            onClick={(event) => showPopup(event, "team", team["team members"].join(", "), team.color)}
                          />
                        ))}
                      </div>
                    )}

                    {idx < values.length - 1 && (
                      <div className={`arrow ${rowIndex % 2 === 0 ? "right" : "left"}`} />
                    )}
                    {idx === values.length - 1 && rowIndex < rows - 1 && (
                      <div className="arrow down" />
                    )}
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

export default App;