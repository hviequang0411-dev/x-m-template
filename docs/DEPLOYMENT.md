# Deployment

Production = **Supabase Cloud** (Postgres, Auth, Realtime, Edge Functions) + **Vercel** (static SPA).
Nothing here has been run against a real project yet: it needs your Supabase and Vercel accounts.

## 0. Before you start
- `npm run verify`, `npm run db:test`, `npm run test:integration` and `npm run test:e2e` are green locally.
- Decide the production app URL (e.g. `https://xam-online.vercel.app`). You need it for Auth settings.

## 1. Supabase project
1. Create a project in the Supabase dashboard (region close to the players, e.g. Singapore).
2. Link the repo (asks for the database password):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```
3. Push the schema. This applies `supabase/migrations/0001…0008` in order, including the `xam-baseline` v1 ruleset row:
   ```bash
   npx supabase db push
   ```
4. Deploy the Edge Functions (they share `supabase/functions/deno.json` as import map; `verify_jwt` is on for all):
   ```bash
   npx supabase functions deploy create-room join-room leave-room start-match play-cards pass-turn claim-timeout finish-match
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. Do **not** add the
   service-role key anywhere else.

## 2. Auth settings (dashboard → Authentication)
`supabase/config.toml` configures only the local stack; set these in the dashboard:

| Setting | Value |
|---|---|
| Site URL | the production app URL |
| Redirect URLs | the production app URL (and preview URLs if you use them) |
| Email confirmations | your choice. If on, registration shows "Đăng ký thành công · kiểm tra email" and the user logs in after confirming |
| Rate limits | keep the defaults. The raised `sign_in_sign_ups = 1000` in `config.toml` is for local integration tests only |
| Minimum password length | 8 (the client already requires 8) |

## 3. Vercel
1. Import the Git repository. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
2. Environment variables (Production and Preview), public values only:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the project's anon/publishable key
3. `vercel.json` already rewrites every path to `index.html` (deep links like `/match/<id>`) and sets basic security headers.

## 4. Smoke test (after every deploy)
```bash
node scripts/smoke.mjs https://<project-ref>.supabase.co <anon-key> https://<app-url>
```
It uses only public values and checks that anon can't read game tables, all 8 functions are deployed and answer
`401 UNAUTHORIZED` in our envelope, CORS preflight works, deep links serve the app, and the built bundle contains no
service-role key. Then play one match with 4 accounts ([BETA_CHECKLIST.md](BETA_CHECKLIST.md)).

## 5. Later changes
- Schema: add a new migration file, never edit an applied one; `npx supabase db push`.
- A rule change is a **new ruleset version** (new row + new constant in `game-engine/ruleset.ts`); approved rows are immutable.
- Functions: `npx supabase functions deploy <name>`.

## Rollback
- Frontend: promote the previous Vercel deployment.
- Functions: redeploy from the previous commit.
- Database: migrations are forward-only. Write a new migration that reverts the change. Take a backup (dashboard → Database → Backups) before pushing risky migrations.
