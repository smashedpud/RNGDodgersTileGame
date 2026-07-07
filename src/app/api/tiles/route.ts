import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createTile,
  deleteTile,
  getTileManagementData,
  updateTile,
} from "@/lib/game-data-repository";
import { canManageTiles } from "@/lib/permissions";
import type { TileAction, TileDefinition } from "@/lib/types";

type TileDraft = Omit<TileDefinition, "id">;

function normalizeAction(value: unknown): TileAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const action = value as Record<string, unknown>;
  if (action.kind === "reroll") {
    return { kind: "reroll" };
  }

  if (action.kind === "move-relative" || action.kind === "move-absolute") {
    const numeric = Number(action.value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }

    return {
      kind: action.kind,
      value: numeric,
    };
  }

  return undefined;
}

function normalizeTile(input: unknown): TileDraft | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) {
    return null;
  }

  const subtitle = typeof candidate.subtitle === "string" ? candidate.subtitle.trim() : "";
  const image = typeof candidate.image === "string" ? candidate.image.trim() : "";
  const action = normalizeAction(candidate.action);

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(image ? { image } : {}),
    ...(action ? { action } : {}),
  };
}

async function assertAdmin() {
  const session = await auth();
  if (!session?.user?.discordId) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  if (!canManageTiles(session.user.permission)) {
    return { ok: false as const, response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }

  return { ok: true as const };
}

export async function GET() {
  try {
    const gate = await assertAdmin();
    if (!gate.ok) {
      return gate.response;
    }

    const data = await getTileManagementData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load tiles", error);
    return NextResponse.json({ error: "Failed to load tiles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await assertAdmin();
    if (!gate.ok) {
      return gate.response;
    }

    const body = (await request.json()) as { tile?: unknown };
    const tile = normalizeTile(body.tile);
    if (!tile) {
      return NextResponse.json({ error: "Invalid tile payload" }, { status: 400 });
    }

    const created = await createTile(tile);
    return NextResponse.json({ tile: created });
  } catch (error) {
    console.error("Failed to create tile", error);
    return NextResponse.json({ error: "Failed to create tile" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const gate = await assertAdmin();
    if (!gate.ok) {
      return gate.response;
    }

    const body = (await request.json()) as { id?: string; tile?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const tile = normalizeTile(body.tile);

    if (!id || !tile) {
      return NextResponse.json({ error: "Body must include tile id and tile payload" }, { status: 400 });
    }

    const changed = await updateTile(id, tile);
    if (!changed) {
      return NextResponse.json({ error: "Tile not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update tile", error);
    return NextResponse.json({ error: "Failed to update tile" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const gate = await assertAdmin();
    if (!gate.ok) {
      return gate.response;
    }

    const body = (await request.json()) as { id?: string };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Body must include tile id" }, { status: 400 });
    }

    const result = await deleteTile(id);
    if (!result.deleted) {
      return NextResponse.json({ error: result.message ?? "Tile not found" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete tile", error);
    return NextResponse.json({ error: "Failed to delete tile" }, { status: 500 });
  }
}
