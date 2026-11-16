# Xam Online

A private multiplayer web app for the Vietnamese card game Xâm (Sâm), with 4 players per room. React + Supabase, server-authoritative.

## Docs
- [Business rules (approved)](docs/BUSINESS_RULES.md) · [Rule decisions](docs/RULE_DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Tasks & progress](docs/DEVELOPMENT_TASKS.md)

## Prerequisites
Node 20+ and Docker Desktop running (the Supabase CLI uses it for the local stack). Make sure there is free disk space on Docker's drive.

## Local setup
```bash
npm install
npm run db:start          # starts local Supabase and applies migrations
npx supabase status       # copy API URL + anon/publishable key
cp .env.example .env.local  # paste those two values
npm run dev
```

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run verify` | typecheck + lint + unit tests + build + bundle secret scan |
| `npm run db:reset` | Recreate the local DB from migrations |
| `npm run db:test` | pgTAP database and RLS tests |

## Security rules
- Only `VITE_SUPABASE_URL` and the anon key go in frontend env. The service-role key lives only in Supabase Edge Function secrets.
- Clients can read through RLS; every write to game state goes through Edge Functions → SECURITY DEFINER RPCs.

## Status
Day 4 of 7 complete. See the [progress log](docs/DEVELOPMENT_TASKS.md#progress-log).
