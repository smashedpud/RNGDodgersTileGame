import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByDiscordId, replaceLeaderboard, updateTeamRolls } from "@/lib/game-data-repository";
import { canEditTeamRolls } from "@/lib/permissions";
import type { RawLeaderboardEntry } from "@/lib/types";

type TeamRollsPayload = {
  team?: string;
  rolls?: number[];
};

function isValidRolls(rolls: number[]) {
  return rolls.every((roll) => Number.isInteger(roll) && roll > 0);
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const permission = session?.user?.permission;

    if (!session?.user?.discordId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as { entries?: RawLeaderboardEntry[] } & TeamRollsPayload;
    const entries = Array.isArray(body.entries) ? body.entries : null;

    if (entries) {
      if (!canEditTeamRolls(permission)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }

      await replaceLeaderboard(entries);
      return NextResponse.json({ ok: true });
    }

    const team = typeof body.team === "string" ? body.team.trim() : "";
    const rolls = Array.isArray(body.rolls) ? body.rolls : null;

    if (!team || !rolls) {
      return NextResponse.json({ error: "Body must include entries array or team + rolls" }, { status: 400 });
    }

    if (!isValidRolls(rolls)) {
      return NextResponse.json({ error: "Rolls must be positive integers" }, { status: 400 });
    }

    if (!canEditTeamRolls(permission)) {
      const mappedUser = await getUserByDiscordId(session.user.discordId);
      if (!mappedUser || !mappedUser.team) {
        return NextResponse.json({ error: "No team mapping configured for this user" }, { status: 403 });
      }

      if (mappedUser.team !== team) {
        return NextResponse.json({ error: "You can only update rolls for your own team" }, { status: 403 });
      }
    }

    const changed = await updateTeamRolls(team, rolls);
    if (!changed) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update leaderboard", error);
    return NextResponse.json({ error: "Failed to update leaderboard" }, { status: 500 });
  }
}
