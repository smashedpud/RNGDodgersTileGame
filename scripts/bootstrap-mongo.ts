// Polyfill for Bun: MongoDB driver checks v8.isBuildingSnapshot which Bun doesn't implement
if (typeof (globalThis as any).Bun !== "undefined") {
  const originalGetBuiltinModule = (process as any).getBuiltinModule;
  if (originalGetBuiltinModule) {
    (process as any).getBuiltinModule = function (name: string) {
      if (name === "v8") {
        return {
          ...originalGetBuiltinModule.call(this, name),
          startupSnapshot: {
            isBuildingSnapshot: () => false,
          },
        };
      }
      return originalGetBuiltinModule.call(this, name);
    };
  }
}

import { bootstrapGameData } from "../src/lib/game-data-repository";
import { getMongoClientPromise } from "../src/lib/mongodb";

function isStrictMode() {
  return process.env.NODE_ENV === "production" || process.env.MONGO_BOOTSTRAP_STRICT === "true";
}

function isOutOfDiskError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: number; codeName?: string; message?: string };
  return (
    candidate.code === 14031 ||
    candidate.codeName === "OutOfDiskSpace" ||
    (typeof candidate.message === "string" && candidate.message.includes("OutOfDiskSpace"))
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (isStrictMode()) {
      throw new Error("Missing MONGODB_URI while strict bootstrap mode is enabled.");
    }

    console.warn("[bootstrap] MONGODB_URI not set. Skipping Mongo bootstrap for local run.");
    return;
  }

  console.log("[bootstrap] Initializing MongoDB data...");
  await bootstrapGameData();
  console.log("[bootstrap] MongoDB data ready.");
}

main()
  .catch((error) => {
    if (isOutOfDiskError(error)) {
      console.warn("[bootstrap] Mongo is out of disk space. Starting in read-only fallback mode.");
      console.warn(error);
      return;
    }

    if (isStrictMode()) {
      console.error("[bootstrap] Failed to initialize MongoDB data.", error);
      process.exitCode = 1;
      return;
    }

    console.warn("[bootstrap] Mongo bootstrap failed. Continuing in non-strict mode.");
    console.warn(error);
  })
  .finally(async () => {
    try {
      const client = await getMongoClientPromise();
      await client.close();
    } catch {
      // Ignore close errors when bootstrap already failed to connect.
    }
  });
