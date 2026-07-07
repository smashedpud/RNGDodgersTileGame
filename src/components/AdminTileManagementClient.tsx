"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import React, { useEffect, useMemo, useState } from "react";
import type { BoardId, BoardLayout, TileAction, TileDefinition, TileManagementDataResponse } from "@/lib/types";

type Props = {
  initialBoard: BoardId;
};

type TileDraft = {
  title: string;
  subtitle: string;
  image: string;
  actionKind: "none" | "reroll" | "move-relative" | "move-absolute";
  actionValue: string;
};

const EMPTY_TILE_DRAFT: TileDraft = {
  title: "",
  subtitle: "",
  image: "",
  actionKind: "none",
  actionValue: "",
};

function toDraft(tile: TileDefinition): TileDraft {
  const action = tile.action;

  if (!action) {
    return {
      title: tile.title,
      subtitle: tile.subtitle ?? "",
      image: tile.image ?? "",
      actionKind: "none",
      actionValue: "",
    };
  }

  if (action.kind === "reroll") {
    return {
      title: tile.title,
      subtitle: tile.subtitle ?? "",
      image: tile.image ?? "",
      actionKind: "reroll",
      actionValue: "",
    };
  }

  return {
    title: tile.title,
    subtitle: tile.subtitle ?? "",
    image: tile.image ?? "",
    actionKind: action.kind,
    actionValue: String(action.value),
  };
}

function toAction(draft: TileDraft): TileAction | undefined {
  if (draft.actionKind === "none") {
    return undefined;
  }

  if (draft.actionKind === "reroll") {
    return { kind: "reroll" };
  }

  const numeric = Number(draft.actionValue);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return {
    kind: draft.actionKind,
    value: numeric,
  };
}

function toTilePayload(draft: TileDraft) {
  const title = draft.title.trim();
  const subtitle = draft.subtitle.trim();
  const image = draft.image.trim();
  const action = toAction(draft);

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(image ? { image } : {}),
    ...(action ? { action } : {}),
  };
}

function getSortedTileKeys(layout: BoardLayout) {
  return Object.keys(layout.slots)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function copyLayout(layout: BoardLayout): BoardLayout {
  return {
    key: layout.key,
    slots: { ...layout.slots },
    ...(layout.start ? { start: { ...layout.start } } : {}),
    ...(layout.finish ? { finish: { ...layout.finish } } : {}),
  };
}

export function AdminTileManagementClient({ initialBoard }: Props) {
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TileManagementDataResponse | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<BoardId>(initialBoard);
  const [tileDrafts, setTileDrafts] = useState<Record<string, TileDraft>>({});
  const [newTileDraft, setNewTileDraft] = useState<TileDraft>(EMPTY_TILE_DRAFT);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [boardSaveStatus, setBoardSaveStatus] = useState<Record<BoardId, string>>({ board1: "", board2: "" });
  const [slotInputs, setSlotInputs] = useState<Record<BoardId, { number: string; tileId: string }>>({
    board1: { number: "", tileId: "" },
    board2: { number: "", tileId: "" },
  });

  const isAdmin = session?.user?.permission === "admin";

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/tiles", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to load tile management data");
      }

      const payload = (await response.json()) as TileManagementDataResponse;
      setData(payload);
      setTileDrafts(
        Object.fromEntries(payload.tiles.map((tile) => [tile.id, toDraft(tile)])),
      );
      setSelectedBoard((current) => (payload.boards[current] ? current : "board1"));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load data";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadData();
  }, [isAdmin]);

  const activeBoardLayout = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.boards[selectedBoard] ?? null;
  }, [data, selectedBoard]);

  const tileOptions = useMemo(() => {
    return data?.tiles ?? [];
  }, [data]);

  const updateTileDraft = (tileId: string, key: keyof TileDraft, value: string) => {
    setTileDrafts((current) => ({
      ...current,
      [tileId]: {
        ...(current[tileId] ?? EMPTY_TILE_DRAFT),
        [key]: value,
      },
    }));
  };

  const saveTile = async (tileId: string) => {
    const draft = tileDrafts[tileId];
    if (!draft) {
      return;
    }

    const payload = toTilePayload(draft);
    if (!payload.title) {
      setSaveMessage("Tile title is required.");
      return;
    }

    if (draft.actionKind !== "none" && draft.actionKind !== "reroll" && !Number.isFinite(Number(draft.actionValue))) {
      setSaveMessage("Action value must be numeric.");
      return;
    }

    const response = await fetch("/api/tiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: tileId, tile: payload }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setSaveMessage(result?.error ?? "Failed to save tile.");
      return;
    }

    setSaveMessage("Tile updated.");
    await loadData();
  };

  const addTile = async () => {
    const payload = toTilePayload(newTileDraft);
    if (!payload.title) {
      setSaveMessage("Tile title is required.");
      return;
    }

    if (
      newTileDraft.actionKind !== "none" &&
      newTileDraft.actionKind !== "reroll" &&
      !Number.isFinite(Number(newTileDraft.actionValue))
    ) {
      setSaveMessage("Action value must be numeric.");
      return;
    }

    const response = await fetch("/api/tiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tile: payload }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setSaveMessage(result?.error ?? "Failed to create tile.");
      return;
    }

    setNewTileDraft(EMPTY_TILE_DRAFT);
    setSaveMessage("Tile created.");
    await loadData();
  };

  const removeTile = async (tileId: string) => {
    const response = await fetch("/api/tiles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: tileId }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setSaveMessage(result?.error ?? "Failed to delete tile.");
      return;
    }

    setSaveMessage("Tile deleted.");
    await loadData();
  };

  const updateBoardSlot = (boardId: BoardId, tileNumber: number, tileId: string) => {
    setData((current) => {
      if (!current) {
        return current;
      }

      const nextBoards = { ...current.boards };
      const board = copyLayout(nextBoards[boardId]);

      if (!tileId) {
        delete board.slots[String(tileNumber)];
      } else {
        board.slots[String(tileNumber)] = tileId;
      }

      nextBoards[boardId] = board;
      return {
        ...current,
        boards: nextBoards,
      };
    });
  };

  const updateBoardSpecial = (
    boardId: BoardId,
    section: "start" | "finish",
    field: "title" | "subtitle",
    value: string,
  ) => {
    setData((current) => {
      if (!current) {
        return current;
      }

      const nextBoards = { ...current.boards };
      const board = copyLayout(nextBoards[boardId]);
      const currentValue = board[section] ?? { title: "", subtitle: "" };

      board[section] = {
        ...currentValue,
        [field]: value,
      };

      nextBoards[boardId] = board;
      return {
        ...current,
        boards: nextBoards,
      };
    });
  };

  const addBoardSlot = (boardId: BoardId) => {
    const value = slotInputs[boardId];
    const tileNumber = Number(value.number);
    if (!Number.isInteger(tileNumber) || tileNumber <= 0 || !value.tileId) {
      setBoardSaveStatus((current) => ({
        ...current,
        [boardId]: "Slot number must be a positive integer and tile must be selected.",
      }));
      return;
    }

    updateBoardSlot(boardId, tileNumber, value.tileId);
    setSlotInputs((current) => ({
      ...current,
      [boardId]: { number: "", tileId: "" },
    }));
    setBoardSaveStatus((current) => ({ ...current, [boardId]: "" }));
  };

  const saveBoard = async (boardId: BoardId) => {
    if (!data) {
      return;
    }

    const board = data.boards[boardId];
    const response = await fetch("/api/boards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boardId,
        slots: board.slots,
        start: board.start,
        finish: board.finish,
      }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setBoardSaveStatus((current) => ({
        ...current,
        [boardId]: result?.error ?? "Failed to save board.",
      }));
      return;
    }

    setBoardSaveStatus((current) => ({ ...current, [boardId]: "Board saved." }));
    await loadData();
  };

  if (status === "loading") {
    return <div className="admin-page">Checking authentication...</div>;
  }

  if (!session?.user?.discordId) {
    return (
      <div className="admin-page">
        <h1>Tile Management</h1>
        <p>You must be signed in as an admin to manage tiles and boards.</p>
        <button type="button" className="roll-save-button" onClick={() => signIn("discord")}>Sign in</button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="admin-page">
        <h1>Tile Management</h1>
        <p>Your account does not have admin permissions.</p>
        <p><Link href="/">Back to game board</Link></p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="admin-page">Loading tile management data...</div>;
  }

  if (error || !data || !activeBoardLayout) {
    return (
      <div className="admin-page">
        <h1>Tile Management</h1>
        <p>{error ?? "Failed to load tile management data."}</p>
      </div>
    );
  }

  const tileNameById = Object.fromEntries(data.tiles.map((tile) => [tile.id, tile.title]));

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Tile and Board Management</h1>
        <p><Link href="/">Back to game board</Link></p>
      </header>

      {saveMessage ? <div className="roll-save-status success">{saveMessage}</div> : null}

      <section className="admin-card">
        <h2>Create Tile</h2>
        <div className="admin-grid-5">
          <input
            type="text"
            className="roll-editor-input"
            placeholder="Title"
            value={newTileDraft.title}
            onChange={(event) => setNewTileDraft((current) => ({ ...current, title: event.target.value }))}
          />
          <input
            type="text"
            className="roll-editor-input"
            placeholder="Subtitle"
            value={newTileDraft.subtitle}
            onChange={(event) => setNewTileDraft((current) => ({ ...current, subtitle: event.target.value }))}
          />
          <input
            type="text"
            className="roll-editor-input"
            placeholder="Image URL"
            value={newTileDraft.image}
            onChange={(event) => setNewTileDraft((current) => ({ ...current, image: event.target.value }))}
          />
          <select
            className="roll-editor-input"
            value={newTileDraft.actionKind}
            onChange={(event) => setNewTileDraft((current) => ({ ...current, actionKind: event.target.value as TileDraft["actionKind"] }))}
          >
            <option value="none">No action</option>
            <option value="reroll">Reroll</option>
            <option value="move-relative">Move relative</option>
            <option value="move-absolute">Move absolute</option>
          </select>
          <input
            type="text"
            className="roll-editor-input"
            placeholder="Action value"
            value={newTileDraft.actionValue}
            onChange={(event) => setNewTileDraft((current) => ({ ...current, actionValue: event.target.value }))}
            disabled={newTileDraft.actionKind === "none" || newTileDraft.actionKind === "reroll"}
          />
        </div>
        <div className="admin-actions-row">
          <button type="button" className="roll-save-button" onClick={() => void addTile()}>Create tile</button>
        </div>
      </section>

      <section className="admin-card">
        <h2>Tiles</h2>
        <div className="admin-tile-list">
          {data.tiles.map((tile) => {
            const draft = tileDrafts[tile.id] ?? toDraft(tile);
            return (
              <div key={tile.id} className="admin-tile-row">
                <input
                  type="text"
                  className="roll-editor-input"
                  value={draft.title}
                  onChange={(event) => updateTileDraft(tile.id, "title", event.target.value)}
                />
                <input
                  type="text"
                  className="roll-editor-input"
                  value={draft.subtitle}
                  onChange={(event) => updateTileDraft(tile.id, "subtitle", event.target.value)}
                />
                <input
                  type="text"
                  className="roll-editor-input"
                  value={draft.image}
                  onChange={(event) => updateTileDraft(tile.id, "image", event.target.value)}
                />
                <select
                  className="roll-editor-input"
                  value={draft.actionKind}
                  onChange={(event) => updateTileDraft(tile.id, "actionKind", event.target.value)}
                >
                  <option value="none">No action</option>
                  <option value="reroll">Reroll</option>
                  <option value="move-relative">Move relative</option>
                  <option value="move-absolute">Move absolute</option>
                </select>
                <input
                  type="text"
                  className="roll-editor-input"
                  value={draft.actionValue}
                  onChange={(event) => updateTileDraft(tile.id, "actionValue", event.target.value)}
                  disabled={draft.actionKind === "none" || draft.actionKind === "reroll"}
                />
                <button type="button" className="roll-save-button" onClick={() => void saveTile(tile.id)}>Save</button>
                <button type="button" className="roll-save-button user-delete-button" onClick={() => void removeTile(tile.id)}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-board-tabs">
          <button
            type="button"
            className={selectedBoard === "board1" ? "board-button active" : "board-button"}
            onClick={() => setSelectedBoard("board1")}
          >
            Board 1
          </button>
          <button
            type="button"
            className={selectedBoard === "board2" ? "board-button active" : "board-button"}
            onClick={() => setSelectedBoard("board2")}
          >
            Board 2
          </button>
        </div>

        <h2>Edit {selectedBoard === "board1" ? "Board 1" : "Board 2"}</h2>

        <div className="admin-grid-2">
          <input
            type="text"
            className="roll-editor-input"
            value={activeBoardLayout.start?.title ?? ""}
            placeholder="Start title"
            onChange={(event) => updateBoardSpecial(selectedBoard, "start", "title", event.target.value)}
          />
          <input
            type="text"
            className="roll-editor-input"
            value={activeBoardLayout.start?.subtitle ?? ""}
            placeholder="Start subtitle"
            onChange={(event) => updateBoardSpecial(selectedBoard, "start", "subtitle", event.target.value)}
          />
          <input
            type="text"
            className="roll-editor-input"
            value={activeBoardLayout.finish?.title ?? ""}
            placeholder="Finish title"
            onChange={(event) => updateBoardSpecial(selectedBoard, "finish", "title", event.target.value)}
          />
          <input
            type="text"
            className="roll-editor-input"
            value={activeBoardLayout.finish?.subtitle ?? ""}
            placeholder="Finish subtitle"
            onChange={(event) => updateBoardSpecial(selectedBoard, "finish", "subtitle", event.target.value)}
          />
        </div>

        <div className="admin-slot-add-row">
          <input
            type="number"
            className="roll-editor-input"
            placeholder="Tile number"
            value={slotInputs[selectedBoard].number}
            onChange={(event) =>
              setSlotInputs((current) => ({
                ...current,
                [selectedBoard]: { ...current[selectedBoard], number: event.target.value },
              }))
            }
          />
          <select
            className="roll-editor-input"
            value={slotInputs[selectedBoard].tileId}
            onChange={(event) =>
              setSlotInputs((current) => ({
                ...current,
                [selectedBoard]: { ...current[selectedBoard], tileId: event.target.value },
              }))
            }
          >
            <option value="">Select tile</option>
            {tileOptions.map((tile) => (
              <option key={tile.id} value={tile.id}>{tile.title}</option>
            ))}
          </select>
          <button type="button" className="roll-save-button" onClick={() => addBoardSlot(selectedBoard)}>
            Add Slot
          </button>
        </div>

        <div className="admin-slot-table">
          {getSortedTileKeys(activeBoardLayout).map((tileNumber) => (
            <div className="admin-slot-row" key={`${selectedBoard}-${tileNumber}`}>
              <span className="admin-slot-number">Tile {tileNumber}</span>
              <select
                className="roll-editor-input"
                value={activeBoardLayout.slots[String(tileNumber)] ?? ""}
                onChange={(event) => updateBoardSlot(selectedBoard, tileNumber, event.target.value)}
              >
                <option value="">No tile</option>
                {tileOptions.map((tile) => (
                  <option key={tile.id} value={tile.id}>{tile.title}</option>
                ))}
              </select>
              <span className="admin-slot-label">
                {tileNameById[activeBoardLayout.slots[String(tileNumber)] ?? ""] ?? "Unassigned"}
              </span>
              <button
                type="button"
                className="roll-save-button user-delete-button"
                onClick={() => updateBoardSlot(selectedBoard, tileNumber, "")}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {boardSaveStatus[selectedBoard] ? (
          <div className="roll-save-status success">{boardSaveStatus[selectedBoard]}</div>
        ) : null}

        <div className="admin-actions-row">
          <button type="button" className="roll-save-button" onClick={() => void saveBoard(selectedBoard)}>
            Save Board Layout
          </button>
        </div>
      </section>
    </div>
  );
}
