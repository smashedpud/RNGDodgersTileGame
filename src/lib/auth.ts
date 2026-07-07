import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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

const localOverrideEnabled =
  process.env.LOCAL_AUTH_OVERRIDE === "true" && process.env.NODE_ENV !== "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/api/auth",
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "identify email",
          prompt: "none",
        },
      },
    }),
    ...(localOverrideEnabled
      ? [
          Credentials({
            id: "local-override",
            name: "Local Override",
            credentials: {
              discordId: { label: "Discord ID", type: "text" },
              displayName: { label: "Display Name", type: "text" },
            },
            authorize(credentials) {
              const discordId =
                String(credentials?.discordId ?? "").trim() ||
                process.env.LOCAL_AUTH_OVERRIDE_DISCORD_ID ||
                "local-admin";
              const displayName =
                String(credentials?.displayName ?? "").trim() ||
                process.env.LOCAL_AUTH_OVERRIDE_NAME ||
                "Local Admin";

              if (!discordId) {
                return null;
              }

              return {
                id: discordId,
                name: displayName,
                email: null,
              };
            },
          }),
        ]
      : []),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.provider === "discord") {
        token.discordId = account.providerAccountId;
        token.authProvider = "discord";
      }

      if (account?.provider === "local-override") {
        token.discordId =
          typeof user?.id === "string"
            ? user.id
            : process.env.LOCAL_AUTH_OVERRIDE_DISCORD_ID ?? "local-admin";
        token.authProvider = "local-override";
        token.permission = "admin";
        return token;
      }

      if (token.authProvider === "local-override") {
        token.permission = "admin";
        return token;
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
