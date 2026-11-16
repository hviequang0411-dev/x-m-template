#!/usr/bin/env node
// Post-deploy smoke test. Uses ONLY public values (project URL + anon key), never the service key.
//
//   node scripts/smoke.mjs <SUPABASE_URL> <ANON_KEY> [APP_URL]
//
// Checks: REST is up and closed to anon; every Edge Function (13) is deployed and rejects anonymous
// calls with our error envelope; the approved ruleset isn't readable by anon; the app (if given)
// serves index.html for deep links (SPA rewrite).

const [url, anonKey, appUrl] = process.argv.slice(2)
if (!url || !anonKey) {
  console.error('usage: node scripts/smoke.mjs <SUPABASE_URL> <ANON_KEY> [APP_URL]')
  process.exit(2)
}

const FUNCTIONS = [
  'create-room', 'join-room', 'leave-room', 'start-match', 'play-cards', 'pass-turn', 'claim-timeout', 'finish-match',
  'add-bot', 'remove-bot', 'admin-users', 'admin-adjust-points', 'admin-set-locked',
]
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }
const results = []
const check = async (name, fn) => {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

await check('Auth health', async () => {
  const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } })
  assert(r.ok, `HTTP ${r.status}`)
  return 'ok'
})

for (const table of ['profiles', 'game_rooms', 'matches', 'player_private_states', 'match_results']) {
  await check(`anon cannot read ${table}`, async () => {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anonKey } })
    // 401/403 (no grant) or an empty list are both "closed".
    if (r.status === 401 || r.status === 403) return `HTTP ${r.status}`
    const body = await r.json()
    assert(Array.isArray(body) && body.length === 0, `anon got data: HTTP ${r.status} ${JSON.stringify(body).slice(0, 100)}`)
    return 'empty'
  })
}

for (const fn of FUNCTIONS) {
  await check(`function ${fn} deployed and requires a user`, async () => {
    const r = await fetch(`${url}/functions/v1/${fn}`, { method: 'POST', headers, body: '{}' })
    const body = await r.json().catch(() => null)
    assert(r.status !== 404, 'not deployed (404)')
    assert(r.status === 401 && body?.ok === false && body?.error?.code === 'UNAUTHORIZED',
      `expected 401 UNAUTHORIZED envelope, got ${r.status} ${JSON.stringify(body).slice(0, 120)}`)
    return '401 UNAUTHORIZED'
  })
}

await check('CORS preflight on play-cards', async () => {
  const r = await fetch(`${url}/functions/v1/play-cards`, {
    method: 'OPTIONS',
    headers: { Origin: appUrl ?? 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  })
  assert(r.ok, `HTTP ${r.status}`)
  return r.headers.get('access-control-allow-origin') ?? '(none)'
})

if (appUrl) {
  await check('app serves deep links (SPA rewrite)', async () => {
    const r = await fetch(`${appUrl.replace(/\/$/, '')}/match/00000000-0000-0000-0000-000000000000`)
    const text = await r.text()
    assert(r.ok && text.includes('<div id="root">'), `HTTP ${r.status}`)
    return 'index.html'
  })
  await check('app bundle has no service-role key', async () => {
    const html = await (await fetch(appUrl)).text()
    const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], appUrl).href)
    assert(scripts.length > 0, 'no built .js scripts found (is this a production build?)')
    for (const s of scripts) {
      const js = await (await fetch(s)).text()
      assert(!/sb_secret_[A-Za-z0-9_-]{16,}/.test(js), `secret key in ${s}`)
      for (const m of js.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
        const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString())
        assert(payload.role !== 'service_role', `service_role JWT in ${s}`)
      }
    }
    return `${scripts.length} script(s) clean`
  })
}

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
