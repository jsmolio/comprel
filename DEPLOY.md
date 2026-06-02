# Deploying compREL

Stack: **Vercel** (web) + **Supabase** (Postgres) + **GitHub Actions** (scheduled ingest).

## 1. Provision Supabase (you)
1. Create a project at [supabase.com](https://supabase.com).
2. Project → **Connect** → **ORMs / Prisma** (or Database → Connection string). Grab two URLs:
   - **Pooled** (Transaction pooler, port `6543`) → `DATABASE_URL`
   - **Direct** (port `5432`) → `DIRECT_URL`
3. Put both in your local `.env` (replace the SQLite `DATABASE_URL`). See [.env.example](.env.example) for the exact shape (include `?pgbouncer=true&connection_limit=1&sslmode=require` on the pooled one).

## 2. Cut over to Postgres + seed (assistant)
- Switch `prisma/schema.prisma` datasource to `postgresql` + add `directUrl`.
- `pnpm prisma migrate dev --name init` → creates the initial migration and applies it to Supabase.
- `pnpm ingest` → one-time full seed (tournaments, decks, matches, aggregates, cards).
- Verify `pnpm dev` renders against Supabase.

## 3. Push to GitHub + import to Vercel
- Create the repo and push (assistant, with your go-ahead): `gh repo create comprel --private --source=. --push`.
- In Vercel: **Add New → Project → Import** the repo. Framework auto-detects Next.js.

## 4. Set environment variables
**Vercel** (Project → Settings → Environment Variables):
- `DATABASE_URL` = Supabase **pooled** URL
- `DIRECT_URL` = Supabase **direct** URL
- `CRON_SECRET` = any random string (protects `/api/ingest`)
- `YOUTUBE_API_KEY` (optional)

**GitHub repo secrets** (Settings → Secrets → Actions), for the ingest workflow:
- `DIRECT_URL` = Supabase **direct** URL

(`GITHUB_TOKEN` is provided automatically to the Action.)

## 5. Deploy + verify
- Vercel builds & deploys on push. Migrations are applied via step 2; ongoing schema changes: `pnpm db:migrate` against `DIRECT_URL` (or add it to the build).
- Trigger the ingest once from the **Actions** tab → "Scheduled ingest" → **Run workflow**, then confirm data on the live site.
- The workflow then runs every 6h automatically.

## Notes
- `/api/ingest` stays as a manual/Vercel-Cron trigger but the **scheduled** path is GitHub Actions (the full ingest exceeds serverless time limits).
- Prisma client is generated on install via the `postinstall` script.
- Local dev can keep using SQLite by pointing `DATABASE_URL` back at `file:./dev.db` (the schema provider must match — keep Postgres for parity once cut over).
