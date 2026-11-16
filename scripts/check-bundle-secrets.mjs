// Fails if the production bundle contains anything that looks like a real
// server-side Supabase credential. Library code that merely mentions the
// "sb_secret_" prefix is fine; an actual key or a service_role JWT is not.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const patterns = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
]

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(js|html|css|map)$/.test(p)) yield p
  }
}

let failed = false
for (const file of files(DIST)) {
  const text = readFileSync(file, 'utf8')
  for (const { name, re } of patterns) {
    for (const match of text.matchAll(new RegExp(re, 'g'))) {
      if (name === 'JWT') {
        // The anon JWT is public by design; only a service_role token is a leak.
        const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString())
        if (payload.role !== 'service_role') continue
      }
      console.error(`✗ ${name} found in ${file}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log('✓ no server-side secrets in dist/')
