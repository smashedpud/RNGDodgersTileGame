import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { getPermissionByDiscordId } from "@/lib/game-data-repository";
import { isValidPermission } from "@/lib/permissions";

function normalizeAuthUrl() {
  const explicitAuthUrl = process.env.AUTH_URL?.trim();
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();

  const railwayAuthUrl = railwayDomain ? `https://${railwayDomain}` : undefined;

  const isDiscordHost = (value: string) => {
    try {
      const parsed = new URL(value);
      return parsed.hostname === "discord.com" || parsed.hostname === "discordapp.com";
    } catch {
      return false;
    }
  };

  if (explicitAuthUrl && !isDiscordHost(explicitAuthUrl)) {
    return explicitAuthUrl;
  }

  if (railwayAuthUrl) {
    return railwayAuthUrl;
  }

  return explicitAuthUrl;
}

const resolvedAuthUrl = normalizeAuthUrl();
if (resolvedAuthUrl) {
  process.env.AUTH_URL = resolvedAuthUrl;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/api/auth",
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.provider === "discord") {
        token.discordId = account.providerAccountId;
      }

      const discordId = typeof token.discordId === "string" ? token.discordId : null;
      if (!discordId) {
        token.permission = "viewer";
        return token;
      }

      try {
        token.permission = await getPermissionByDiscordId(discordId);
      } catch {
        token.permission = "viewer";
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.discordId =
          typeof token.discordId === "string" ? token.discordId : undefined;
        session.user.permission = isValidPermission(token.permission)
          ? token.permission
          : "viewer";
      }

      return session;
    },
  },
});
