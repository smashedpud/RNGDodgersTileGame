"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { DEFAULT_GAME_DATA } from "@/lib/defaultData";
import type { GameUser, RawLeaderboardEntry } from "@/lib/types";

export function AdminUserManagementClient() {
  const { data: session, status } = useSession();
  const [remoteData, setRemoteData] = useState(DEFAULT_GAME_DATA);
  const [userDrafts, setUserDrafts] = useState<GameUser[]>([]);
  const [userSaveStatus, setUserSaveStatus] = useState<{
    state: "idle" | "saving" | "success" | "error";
    message?: string;
  }>({ state: "idle" });

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const response = await fetch("/api/game-data", {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as typeof DEFAULT_GAME_DATA;
        if (!payload?.boards || !Array.isArray(payload.leaderboard)) {
          return;
        }

        setRemoteData(payload);
      } catch {
        // Keep local JSON fallback if API is unavailable.
      }
    };

    void loadData();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setUserDrafts(remoteData.users);
  }, [remoteData.users]);

  const saveUsers = async () => {
    const teamByMemberName = new Map<string, string>();
    remoteData.leaderboard.forEach((entry) => {
      const members = Array.isArray(entry["team members"]) ? entry["team members"] : [];
      const teamName = members.map((member) => String(member).trim()).filter(Boolean).join(" / ");
      members.forEach((member) => {
        const key = String(member).trim().toLowerCase();
        if (key && teamName && !teamByMemberName.has(key)) {
          teamByMemberName.set(key, teamName);
        }
      });
    });

    const normalizedUsers = userDrafts.map((user) => {
      const displayName = user.displayName.trim();
      const discordId = user.discordId.trim();
      const existingTeam = user.team.trim();
      const inferredTeam = teamByMemberName.get(displayName.toLowerCase()) ?? existingTeam;

      return {
        displayName,
        discordId,
        team: inferredTeam,
      };
    });

    const hasInvalid = normalizedUsers.some(
      (user) => !user.displayName || !user.team,
    );

    if (hasInvalid) {
      setUserSaveStatus({
        state: "error",
        message: "Each user needs display name and team.",
      });
      return;
    }

    const nonEmptyIds = normalizedUsers
      .map((user) => user.discordId)
      .filter((discordId) => discordId.length > 0);
    const idSet = new Set(nonEmptyIds);
    if (idSet.size !== nonEmptyIds.length) {
      setUserSaveStatus({
        state: "error",
        message: "Discord IDs must be unique when provided.",
      });
      return;
    }

    setUserSaveStatus({ state: "saving", message: "Saving users..." });

    try {
      const response = await fetch("/api/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ users: normalizedUsers }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save users");
      }

      setRemoteData((current) => ({
        ...current,
        users: normalizedUsers,
      }));
      setUserSaveStatus({ state: "success", message: "Users updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save users";
      setUserSaveStatus({ state: "error", message });
    }
  };

  const updateUserDraft = (index: number, field: keyof GameUser, value: string) => {
    setUserDrafts((current) =>
      current.map((user, currentIndex) =>
        currentIndex === index
          ? {
              ...user,
              [field]: value,
            }
          : user,
      ),
    );
  };

  const removeUserDraft = (index: number) => {
    setUserDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const addUserDraft = () => {
    setUserDrafts((current) => [...current, { displayName: "", discordId: "", team: "" }]);
  };

  const permission = session?.user?.permission ?? "viewer";
  const sessionLabel = session?.user?.name ?? session?.user?.discordId ?? "Guest";
  const isAdmin = permission === "admin";

  if (status === "loading") {
    return (
      <div className="app-shell" style={{ ["--logo-url" as string]: "url(/icon.webp)" } as React.CSSProperties}>
        <header className="page-header">
          <h1 className="page-title">
            RNG Dodgers - <span className="title-accent">User Management</span>
          </h1>
        </header>
        <div className="leaderboard-card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="app-shell" style={{ ["--logo-url" as string]: "url(/icon.webp)" } as React.CSSProperties}>
        <header className="page-header">
          <h1 className="page-title">
            RNG Dodgers - <span className="title-accent">User Management</span>
          </h1>
        </header>
        <div className="leaderboard-card">
          <p>Access denied. Admin privileges required.</p>
          <Link className="board-button" href="/">Back to Game</Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      style={{ ["--logo-url" as string]: "url(/icon.webp)" } as React.CSSProperties}
    >
      <header className="page-header">
        <h1 className="page-title">
          RNG Dodgers - <span className="title-accent">User Management</span>
        </h1>
        <div className="header-controls">
          <div className="auth-controls">
            <span className="auth-badge">
              Signed in as {sessionLabel} (admin)
            </span>
            <button
              type="button"
              className="board-button"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign out
            </button>
          </div>
          <div className="board-menu">
            <Link className="board-button" href="/">
              Back to Game
            </Link>
            <Link className="board-button" href="/admin/tiles">
              Edit Tiles & Boards
            </Link>
          </div>
        </div>
      </header>

      <div className="leaderboard-card user-admin-card">
        <div className="user-admin-header">
          <h2 className="user-admin-title">User Team Mapping</h2>
          <div className="user-admin-actions">
            <button type="button" className="roll-save-button" onClick={addUserDraft}>
              Add User
            </button>
            <button
              type="button"
              className="roll-save-button"
              disabled={userSaveStatus.state === "saving"}
              onClick={() => {
                void saveUsers();
              }}
            >
              Save Users
            </button>
          </div>
        </div>

        {userSaveStatus.state !== "idle" ? (
          <div className={`roll-save-status ${userSaveStatus.state === "error" ? "error" : "success"}`}>
            {userSaveStatus.message}
          </div>
        ) : null}

        <div className="user-admin-table-wrap">
          <table className="leaderboard-table user-admin-table">
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Discord ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {userDrafts.length === 0 ? (
                <tr>
                  <td colSpan={3}>No users configured yet.</td>
                </tr>
              ) : (
                userDrafts.map((user, index) => (
                  <tr key={`${user.discordId}-${index}`}>
                    <td>
                      <input
                        type="text"
                        className="roll-editor-input"
                        value={user.displayName}
                        onChange={(event) => updateUserDraft(index, "displayName", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="roll-editor-input"
                        value={user.discordId}
                        onChange={(event) => updateUserDraft(index, "discordId", event.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="roll-save-button user-delete-button"
                        onClick={() => removeUserDraft(index)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
