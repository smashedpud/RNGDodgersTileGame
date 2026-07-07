# RNG Dodgers Tile Game (Next.js + MongoDB)

This project has been migrated to a full-stack Next.js app so Railway can host both:

- Frontend: app router UI (tile boards + leaderboard)
- Backend: Next.js API routes
- Data: MongoDB (seeded automatically from existing JSON files)

## Stack

- Next.js (App Router)
- React 19
- MongoDB Node driver
- Railway deployment via Nixpacks

## Local Development

1. Install dependencies:

```bash
bun install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Update `.env.local` values:

- `MONGODB_URI`: your MongoDB connection string
- `MONGODB_DB`: database name (default: `rng_dodgers`)

4. Run development server:

```bash
bun run dev
```

`bun run dev` and `bun run start` now run a Mongo bootstrap step first to ensure collections are seeded before the app serves traffic.
If Mongo is not configured locally, bootstrap is skipped in non-production mode so you can still run the app with JSON fallback data.

Open `http://localhost:3000`.

## API Endpoints

- `GET /api/game-data`
	- Returns boards + leaderboard from MongoDB.
	- On first run, seeds MongoDB from:
		- `src/data/squares.json`
		- `src/data/squares-board2.json`
		- `src/data/leaderboard.json`

- `POST /api/leaderboard`
	- Replaces the leaderboard collection.
	- Body shape:

```json
{
	"entries": [
		{
			"team members": ["Name A", "Name B"],
			"rolls": [1, 4, 3],
			"color": "#8b5cf6"
		}
	]
}
```

## Deploy To Railway

1. Push this repo to GitHub.
2. Create a new Railway project from the repo.
3. Add environment variables in Railway:
	 - `MONGODB_URI`
	 - `MONGODB_DB`
	 - `NODE_ENV=production`
	- `NIXPACKS_NODE_VERSION=20`
	- `NIXPACKS_BUN_VERSION=1.2.20`
4. Deploy.

Railway reads `railway.json` and starts the service with:

```bash
bun run start
```

## Notes

- Existing JSON files are still present as defaults and seed sources.
- The UI now fetches data from the backend (`/api/game-data`) instead of bundling data only at build time.
- You can run bootstrap manually with `bun run bootstrap:mongo`.
- Production bootstrap is strict by default (`NODE_ENV=production`), and can be forced in any environment with `MONGO_BOOTSTRAP_STRICT=true`.