/**
 * Rulesets (docs/BUSINESS_RULES.md). Each constant must stay identical to its `game_rulesets.config`
 * row: v1 is seeded in migration 0001, v2 in migration 0009. A rule change means a NEW version,
 * never an edit to an existing object.
 */

interface RuleSetCommon {
  readonly code: 'xam-baseline'
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
  readonly turnTimeoutSeconds: 30
  readonly flags: {
    readonly baoSam: false
    readonly baoMotDen: false
    readonly instantWin: false
    readonly chainBomb: false
  }
}

/** v1 (approved 2026-11-16): exactly 4 players, uncapped losses. */
export interface GameRuleSetV1 extends RuleSetCommon {
  readonly version: 1
  readonly players: 4
  readonly scoring: {
    readonly perCard: 1
    readonly congPenalty: 15
    readonly thoi2: 0
    readonly thoiTuQuy: 0
  }
}

/**
 * v2 (approved 2026-11-17): 2–5 players [R01b]; a player needs 10 points to play a ranked match and
 * never loses more than their balance [R34, R35]; matches with a bot are unranked [R36].
 */
export interface GameRuleSetV2 extends RuleSetCommon {
  readonly version: 2
  readonly minPlayers: 2
  readonly maxPlayers: 5
  readonly scoring: {
    readonly perCard: 1
    readonly congPenalty: 15
    readonly thoi2: 0
    readonly thoiTuQuy: 0
    readonly minBalanceToPlay: 10
    readonly capLossAtBalance: true
  }
  readonly botMatchesRanked: false
}

export type GameRuleSet = GameRuleSetV1 | GameRuleSetV2

/** How many seats a match under this ruleset may have. */
export function playerRange(ruleset: GameRuleSet): { readonly min: number; readonly max: number } {
  return ruleset.version === 1 ? { min: 4, max: 4 } : { min: ruleset.minPlayers, max: ruleset.maxPlayers }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

export const XAM_BASELINE_V1: GameRuleSetV1 = deepFreeze({
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

export const XAM_BASELINE_V2: GameRuleSetV2 = deepFreeze({
  code: 'xam-baseline',
  version: 2,
  minPlayers: 2,
  maxPlayers: 5,
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
  scoring: { perCard: 1, congPenalty: 15, thoi2: 0, thoiTuQuy: 0, minBalanceToPlay: 10, capLossAtBalance: true },
  turnTimeoutSeconds: 30,
  flags: { baoSam: false, baoMotDen: false, instantWin: false, chainBomb: false },
  botMatchesRanked: false,
})

/** The ruleset new rooms use. */
export const CURRENT_RULESET: GameRuleSet = XAM_BASELINE_V2

const KNOWN_RULESETS: readonly GameRuleSet[] = [XAM_BASELINE_V1, XAM_BASELINE_V2]

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
