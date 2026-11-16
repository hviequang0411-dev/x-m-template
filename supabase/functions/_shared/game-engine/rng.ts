/** Returns an integer in [0, maxExclusive). Injected so rule code never touches global randomness. */
export type RandomInt = (maxExclusive: number) => number

/**
 * Deterministic RNG for tests and replays (mulberry32). NOT for real deals:
 * the server uses `cryptoRandomInt`.
 */
export function seededRandomInt(seed: number): RandomInt {
  let state = seed >>> 0
  return (maxExclusive) => {
    assertMax(maxExclusive)
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return Math.floor(u * maxExclusive)
  }
}

/** Unbiased integer from Web Crypto (available in Deno, browsers and Node 19+). */
export function cryptoRandomInt(maxExclusive: number): number {
  assertMax(maxExclusive)
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buf)
    const x = buf[0]!
    if (x < limit) return x % maxExclusive
  }
}

function assertMax(maxExclusive: number): void {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000)
    throw new RangeError(`maxExclusive out of range: ${maxExclusive}`)
}
