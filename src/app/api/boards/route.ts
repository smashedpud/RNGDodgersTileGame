import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateBoardLayout } from "@/lib/game-data-repository";
import { canManageBoards } from "@/lib/permissions";
import type { BoardId, BoardSpecialTile } from "@/lib/types";

function normalizeSpecial(input: unknown): BoardSpecialTile | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const subtitle = typeof candidate.subtitle === "string" ? candidate.subtitle.trim() : "";

  if (!title) {
    return undefined;
  }

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
  };
}

function normalizeSlots(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const slots: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    const numeric = Number(key);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      continue;
    }

    const tileId = typeof value === "string" ? value.trim() : "";
    if (!tileId) {
      continue;
    }

    slots[String(numeric)] = tileId;
  }

  return slots;
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    const permission = session?.user?.permission;

    if (!session?.user?.discordId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!canManageBoards(permission)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = (await request.json()) as {
      boardId?: BoardId;
      slots?: unknown;
      start?: unknown;
      finish?: unknown;
    };

    if (body.boardId !== "board1" && body.boardId !== "board2") {
      return NextResponse.json({ error: "Invalid boardId" }, { status: 400 });
    }

    const slots = normalizeSlots(body.slots);
    if (slots == null) {
      return NextResponse.json({ error: "Body must include slots object" }, { status: 400 });
    }

    const start = normalizeSpecial(body.start);
    const finish = normalizeSpecial(body.finish);

    const result = await updateBoardLayout(body.boardId, { slots, start, finish });
    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? "Failed to update board" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update board", error);
    return NextResponse.json({ error: "Failed to update board" }, { status: 500 });
  }
}
