/**
 * Ruleset `xam-baseline` v1 (approved 2026-11-16, docs/BUSINESS_RULES.md).
 * Must stay identical to the `game_rulesets.config` row seeded in migration 0001.
 * A rule change means a NEW version, never an edit to this object.
 */

export interface GameRuleSet {
  readonly code: 'xam-baseline'
  readonly version: 1
  readonly players: 4
  readonly handSize: 10
  readonly direction: 'CCW'
  readonly suitsMatter: false
  readonly straight: {
    readonly min: 3
    readonly max: 10
    readonly aceLow: true
    readonly twoAllowed: 'LOW_ONLY'
    readonly wrap: false
  }
  readonly fourOfAKindBeats: 'SINGLE_TWO'
  readonly passLocksRound: true
  readonly leaderCanPass: false
  readonly firstLeader: 'RANDOM'
  readonly nextLeader: 'PREVIOUS_WINNER'
  readonly endCondition: 'FIRST_OUT'
  readonly scoring: {
    readonly perCard: 1
    readonly congPenalty: 15
    readonly thoi2: 0
    readonly thoiTuQuy: 0
  }
  readonly turnTimeoutSeconds: 30
  readonly flags: {
    readonly baoSam: false
    readonly baoMotDen: false
    readonly instantWin: false
    readonly chainBomb: false
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

export const XAM_BASELINE_V1: GameRuleSet = deepFreeze({
  code: 'xam-baseline',
  version: 1,
  players: 4,
  handSize: 10,
  direction: 'CCW',
  suitsMatter: false,
  straight: { min: 3, max: 10, aceLow: true, twoAllowed: 'LOW_ONLY', wrap: false },
  fourOfAKindBeats: 'SINGLE_TWO',
  passLocksRound: true,
  leaderCanPass: false,
  firstLeader: 'RANDOM',
  nextLeader: 'PREVIOUS_WINNER',
  endCondition: 'FIRST_OUT',
  scoring: { perCard: 1, congPenalty: 15, thoi2: 0, thoiTuQuy: 0 },
  turnTimeoutSeconds: 30,
  flags: { baoSam: false, baoMotDen: false, instantWin: false, chainBomb: false },
})

const KNOWN_RULESETS: readonly GameRuleSet[] = [XAM_BASELINE_V1]

export class UnknownRulesetError extends Error {
  constructor(code: unknown, version: unknown) {
    super(`UNKNOWN_RULESET: ${String(code)} v${String(version)}`)
    this.name = 'UnknownRulesetError'
  }
}

export class RulesetMismatchError extends Error {
  constructor(code: string, version: number) {
    super(`RULESET_MISMATCH: ${code} v${version} differs from the engine copy`)
    this.name = 'RulesetMismatchError'
  }
}

/** Looks up a ruleset by identity. Throws for any code/version the engine doesn't know. */
export function getRuleset(code: unknown, version: unknown): GameRuleSet {
  const found = KNOWN_RULESETS.find((r) => r.code === code && r.version === version)
  if (!found) throw new UnknownRulesetError(code, version)
  return found
}

/**
 * Validates a DB `config` blob: it must name a known ruleset AND equal the engine copy exactly,
 * so DB config and code can't drift silently. Returns the engine's frozen object.
 */
export function resolveRuleset(config: unknown): GameRuleSet {
  const c = (config ?? {}) as { code?: unknown; version?: unknown }
  const known = getRuleset(c.code, c.version)
  if (canonicalJson(config) !== canonicalJson(known)) throw new RulesetMismatchError(known.code, known.version)
  return known
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const entries = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}
