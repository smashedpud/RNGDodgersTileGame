import type { UserPermission } from "@/lib/permissions";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      discordId?: string;
      permission: UserPermission;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string;
    permission?: UserPermission;
  }
}
