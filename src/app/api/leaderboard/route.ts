import { NextResponse } from "next/server";
import { replaceLeaderboard } from "@/lib/game-data-repository";
import type { RawLeaderboardEntry } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { entries?: RawLeaderboardEntry[] };
    const entries = Array.isArray(body.entries) ? body.entries : null;

    if (!entries) {
      return NextResponse.json({ error: "Body must include entries array" }, { status: 400 });
    }

    await replaceLeaderboard(entries);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update leaderboard", error);
    return NextResponse.json({ error: "Failed to update leaderboard" }, { status: 500 });
  }
}
