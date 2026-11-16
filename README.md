# Xam Online

A private multiplayer web app for the Vietnamese card game Xâm (Sâm), with 4 players per room. React + Supabase, server-authoritative.

Points are for ranking only and have **no monetary value** (R22).

## Docs
- [Business rules (approved)](docs/BUSINESS_RULES.md) · [Rule decisions](docs/RULE_DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API spec](docs/API_SPEC.md)
- [Deployment](docs/DEPLOYMENT.md) · [Private beta checklist](docs/BETA_CHECKLIST.md)
- [Tasks & progress](docs/DEVELOPMENT_TASKS.md)

## Prerequisites
Node 20+ and Docker Desktop running (the Supabase CLI uses it for the local stack). Make sure there is free disk space on Docker's drive.

## Local setup
```bash
npm install
npm run db:start          # starts local Supabase, applies migrations, serves the Edge Functions
npx supabase status       # copy API URL + anon key
cp .env.example .env.local  # paste those two values
npm run dev
```
After adding a new Edge Function folder, restart the stack (`npx supabase stop` then `npm run db:start`) so it gets served.

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run verify` | typecheck (app, tests, tooling) + lint + unit tests + build + bundle secret scan |
| `npm run db:reset` | Recreate the local DB from migrations (deletes local data) |
| `npm run db:test` | pgTAP database, RLS and RPC tests (150 assertions) |
| `npm run test:integration` | Edge Functions, RLS, Realtime and concurrency against the local stack (creates throwaway `@xam.test` users) |
| `npm run test:e2e` | Playwright: 4 browsers register, play a full match and check the result |
| `node scripts/smoke.mjs <url> <anon-key> [app-url]` | Post-deploy smoke test (public values only) |

Playwright's Chromium is installed inside `node_modules` so it doesn't use the system drive:
```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
```

## Security rules
- Only `VITE_SUPABASE_URL` and the anon key go in frontend env. The service-role key lives only in Supabase Edge Function secrets.
- Clients can read through RLS; every write to game state goes through Edge Functions → SECURITY DEFINER RPCs that re-check
  version, turn, card ownership and results under a row lock.
- Hands are readable only by their owner and never broadcast.

## Known limitations (v1)
- **Leaving mid-match (R29)** isn't supported: `leave-room` refuses during a match. An absent player is auto-passed after 30 s instead.
- **Abort (R30)** only after 5 minutes without a move, by the host. Abort by agreement of all players isn't implemented.
- Special rules are off: báo sâm, đền, instant wins, chặt chồng (R23–R26). Thối 2 / thối tứ quý are recorded but not scored (R19–R20).
- No public room list (by design, R32). Rooms are joined by code.
- The local stack's Auth sign-in limit is raised for integration tests (`supabase/config.toml`); production uses the dashboard settings.

## Status
Day 7 of 7: built and tested locally; production deployment pending (needs the Supabase and Vercel accounts, see [DEPLOYMENT.md](docs/DEPLOYMENT.md)).
