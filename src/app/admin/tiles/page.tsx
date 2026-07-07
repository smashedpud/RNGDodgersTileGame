import { AdminTileManagementClient } from "@/components/AdminTileManagementClient";
import type { BoardId } from "@/lib/types";

type Props = {
  searchParams?: Promise<{ board?: string }>;
};

export default async function AdminTilesPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : undefined;
  const initialBoard: BoardId = params?.board === "board2" ? "board2" : "board1";

  return <AdminTileManagementClient initialBoard={initialBoard} />;
}
