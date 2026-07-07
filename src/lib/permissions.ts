export type UserPermission = "viewer" | "editor" | "admin";

export const USER_PERMISSIONS: UserPermission[] = ["viewer", "editor", "admin"];

export function isValidPermission(value: unknown): value is UserPermission {
  return typeof value === "string" && USER_PERMISSIONS.includes(value as UserPermission);
}

export function canManageLeaderboard(permission: UserPermission | undefined) {
  return permission === "editor" || permission === "admin";
}

export function canEditTeamRolls(permission: UserPermission | undefined) {
  return permission === "admin";
}

export function canManageUsers(permission: UserPermission | undefined) {
  return permission === "admin";
}
