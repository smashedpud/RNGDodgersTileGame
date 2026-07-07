import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUsers, replaceUsers } from "@/lib/game-data-repository";
import { canManageUsers } from "@/lib/permissions";
import type { GameUser } from "@/lib/types";

function normalizeUser(input: GameUser): GameUser | null {
  const displayName = input.displayName?.trim();
  const discordId = input.discordId?.trim() ?? "";
  const team = input.team?.trim();

  if (!displayName || !team) {
    return null;
  }

  return {
    displayName,
    discordId,
    team,
  };
}

function hasDuplicateDiscordIds(users: GameUser[]) {
  const seen = new Set<string>();
  for (const user of users) {
    if (!user.discordId) {
      continue;
    }

    if (seen.has(user.discordId)) {
      return true;
    }
    seen.add(user.discordId);
  }
  return false;
}

export async function GET() {
  try {
    const users = await getUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Failed to load users", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    const permission = session?.user?.permission;

    if (!session?.user?.discordId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!canManageUsers(permission)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = (await request.json()) as { users?: GameUser[] };
    const rawUsers = Array.isArray(body.users) ? body.users : null;

    if (!rawUsers) {
      return NextResponse.json({ error: "Body must include users array" }, { status: 400 });
    }

    const normalized = rawUsers
      .map((user) => normalizeUser(user))
      .filter((user): user is GameUser => user != null);

    if (normalized.length !== rawUsers.length) {
      return NextResponse.json({ error: "Each user must have displayName and team" }, { status: 400 });
    }

    if (hasDuplicateDiscordIds(normalized)) {
      return NextResponse.json({ error: "discordId values must be unique" }, { status: 400 });
    }

    await replaceUsers(normalized);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update users", error);
    return NextResponse.json({ error: "Failed to update users" }, { status: 500 });
  }
}
