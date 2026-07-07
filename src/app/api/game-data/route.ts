import { NextResponse } from "next/server";
import { getGameData } from "@/lib/game-data-repository";

export async function GET() {
  try {
    const data = await getGameData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load game data", error);
    return NextResponse.json({ error: "Failed to load game data" }, { status: 500 });
  }
}
