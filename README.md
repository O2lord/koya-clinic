# Clinic Booking API

Next.js + Supabase implementation of the Koya assessment, Task 1.

## How it works

- `supabase/schema.sql` holds the tables and Postgres functions. Every rule that must be race-safe lives in the database:
  - **No double booking:** a partial unique index allows one `confirmed` booking per slot. A losing request gets a 409.
  - **Idempotency:** requests with the same `Idempotency-Key` are serialized with an advisory lock and the first response is stored and replayed. Same key with a different body returns 422.
  - **Rate limit:** 5 attempts per email per rolling minute (failed attempts count), then 429 with `Retry-After`.
- `app/*/route.ts` are thin handlers that check the `X-API-Key` header and call the database.
- `app/page.tsx` is the web page. It calls `/ui/*`, a server-side proxy that adds the API key, so the key never reaches the browser.

## Setup

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `API_KEY`.
3. `npm install && npm run dev`
4. Run the checks: `BASE=http://localhost:3000 KEY=<API_KEY> ./scripts/test.sh` (wipes data via `/reset`).

## Deploy

Deploy to Vercel and set the same three environment variables. Re-run the checks against the live URL with `BASE=https://your-app.vercel.app`.
