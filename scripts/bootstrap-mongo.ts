import { bootstrapGameData } from "../src/lib/game-data-repository";
import { getMongoClientPromise } from "../src/lib/mongodb";

function isStrictMode() {
  return process.env.NODE_ENV === "production" || process.env.MONGO_BOOTSTRAP_STRICT === "true";
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
