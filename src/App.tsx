import React, { useEffect, useRef, useState } from "react";
import "./index.css";
import squaresJson from "./data/squares.json";
import squaresBoard2Json from "./data/squares-board2.json";

type Props = {
  total?: number;
  columns?: number;
  minSquare?: number;
  gap?: number;
  squareWidth?: number;
  squareHeight?: number;
};

export function App({ total = 14, columns = 6, minSquare = 70, gap = 10, squareWidth = 120, squareHeight = 80 }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [effectiveColumns, setEffectiveColumns] = useState(columns);
  const [squareData, setSquareData] = useState<Record<number, any>>({});
  const [activeBoard, setActiveBoard] = useState<"board1" | "board2">("board1");

  const boardMap = {
    board1: squaresJson,
    board2: squaresBoard2Json,
  } as const;

  const activeSquaresJson = boardMap[activeBoard];
  const jsonSquareKeys = Object.keys(activeSquaresJson)
    .map((key) => Number(key))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  // compute the active board's numeric range so boards can start at any tile
  const minKey = jsonSquareKeys.length > 0 ? jsonSquareKeys[0] : 1;
  const maxKey = jsonSquareKeys.length > 0 ? jsonSquareKeys[jsonSquareKeys.length - 1] : total;
  const totalSquares = maxKey - minKey + 1;
  const placeholderImage =
    'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22280%22%20height%3D%22280%22%20viewBox%3D%220%200%20280%20280%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%22280%22%20height%3D%22280%22%20fill%3D%22%234a764a%22/%3E%3Ctext%20x%3D%22140%22%20y%3D%22150%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2220%22%20fill%3D%22%23fff%22%3EImage%3C/text%3E%3C/svg%3E';

  useEffect(() => {
    let el = gridRef.current;
    if (!el) {
      el = document.querySelector('.grid') as HTMLDivElement | null;
      if (!el) {
        console.log('grid element not found yet');
        return;
      }
    }
    const compute = (measuredWidth: number) => {
      const elStyle = getComputedStyle(el);
      const gapPx = parseFloat(elStyle.getPropertyValue("--gap")) || gap;
      const minPx = minSquare;

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

      if (squareWidth != null) {
        computedWidth = Math.max(minPx, squareWidth);
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

      const computedHeight = squareHeight != null ? squareHeight : computedWidth;

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
  }, [columns, gap, minSquare]);

  // load square details from imported JSON (bundled at build time)
  useEffect(() => {
    try {
      const map: Record<number, any> = {};
      Object.keys(activeSquaresJson).forEach((k) => {
        const n = Number(k);
        if (!Number.isNaN(n)) map[n] = (activeSquaresJson as any)[k];
      });
      setSquareData(map);
      console.log(`loaded square data for ${activeBoard}`, map);
    } catch (err) {
      console.warn('failed reading imported square data', err);
    }
  }, [activeBoard, activeSquaresJson]);

  const rows = Math.ceil(totalSquares / effectiveColumns);

  const gridRows = Array.from({ length: rows }).map((_, rowIndex) => {
    const rowStart = minKey + rowIndex * effectiveColumns;
    const rowEnd = Math.min(maxKey, rowStart + effectiveColumns - 1);
    const values: number[] = [];
    for (let i = rowStart; i <= rowEnd; i++) values.push(i);
    const placeholderCount = Math.max(0, effectiveColumns - values.length);
    return { values, placeholderCount, rowIndex };
  });

  return (
    <div className="app-shell">
      <header className="page-header">
        <h1 className="page-title">
          RNG Dodgers - <span className="title-accent">Tile Game</span> - 2 Man
        </h1>
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
        </div>
      </header>
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
          {values.map((val, idx) => {
            const info = squareData[val];
            const resolveImageUrl = (src?: string) => {
              if (!src) return undefined;
              if (src.includes("oldschool.runescape.wiki")) {
                return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=png`;
              }
              return src;
            };

            return (
              <div key={val} className={`square ${info ? 'has-info' : ''}`}>
                {info ? (
                  <div className="meta">
                    {info.title && <div className="square-title">{info.title}</div>}
                    {info.subtitle && <div className="square-subtitle">{info.subtitle}</div>}
                    {info.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImageUrl(info.image)}
                        alt={info.title || ''}
                        className="square-image"
                        loading="eager"
                        decoding="async"
                        crossOrigin="anonymous"
                        onError={(event) => {
                          const target = event.currentTarget;
                          if (!target.src.includes('images.weserv.nl')) {
                            target.src = resolveImageUrl(info.image);
                          } else if (target.src !== placeholderImage) {
                            target.src = placeholderImage;
                          }
                        }}
                      />
                    )}
                  </div>
                ) : null}

                <div className="square-number">[{val}]</div>

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
    </div>
  );
}

export default App;