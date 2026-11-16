import { describe, expect, it } from 'vitest'
import migrationSql from '../../../migrations/20261116000001_profiles_and_rulesets.sql?raw'
import {
  XAM_BASELINE_V1,
  getRuleset,
  resolveRuleset,
  RulesetMismatchError,
  UnknownRulesetError,
} from './ruleset.ts'

/** Pulls the JSON literal out of the `insert into public.game_rulesets` statement. */
function seededConfig(): unknown {
  const m = /insert into public\.game_rulesets[\s\S]*?'(\{[\s\S]*?\})'::jsonb/.exec(migrationSql)
  if (!m) throw new Error('ruleset insert not found in migration 0001')
  return JSON.parse(m[1]!)
}

describe('ruleset', () => {
  it('XAM_BASELINE_V1 equals the config row seeded in migration 0001', () => {
    expect(seededConfig()).toEqual(XAM_BASELINE_V1)
    expect(resolveRuleset(seededConfig())).toBe(XAM_BASELINE_V1)
  })

  it('carries the approved values', () => {
    expect(XAM_BASELINE_V1).toMatchObject({
      players: 4,
      handSize: 10,
      direction: 'CCW',
      suitsMatter: false,
      straight: { min: 3, max: 10, wrap: false },
      fourOfAKindBeats: 'SINGLE_TWO',
      scoring: { perCard: 1, congPenalty: 15 },
    })
  })

  it('is deeply frozen', () => {
    expect(Object.isFrozen(XAM_BASELINE_V1)).toBe(true)
    expect(Object.isFrozen(XAM_BASELINE_V1.straight)).toBe(true)
    expect(Object.isFrozen(XAM_BASELINE_V1.flags)).toBe(true)
  })

  it('finds a known ruleset by code and version', () => {
    expect(getRuleset('xam-baseline', 1)).toBe(XAM_BASELINE_V1)
  })

  it.each([
    ['xam-baseline', 2],
    ['xam-baseline', '1'],
    ['tien-len', 1],
    [undefined, undefined],
  ])('rejects unknown ruleset %j v%j', (code, version) => {
    expect(() => getRuleset(code, version)).toThrow(UnknownRulesetError)
  })

  it('rejects a null or unknown config', () => {
    expect(() => resolveRuleset(null)).toThrow(UnknownRulesetError)
    expect(() => resolveRuleset({ ...XAM_BASELINE_V1, version: 9 })).toThrow(UnknownRulesetError)
  })

  it('rejects a known code/version whose values drifted', () => {
    expect(() => resolveRuleset({ ...XAM_BASELINE_V1, handSize: 13 })).toThrow(RulesetMismatchError)
    expect(() =>
      resolveRuleset({ ...XAM_BASELINE_V1, straight: { ...XAM_BASELINE_V1.straight, wrap: true } }),
    ).toThrow(RulesetMismatchError)
    expect(() => resolveRuleset({ ...XAM_BASELINE_V1, extra: 1 })).toThrow(RulesetMismatchError)
  })

  it('ignores key order', () => {
    const reversed = Object.fromEntries(Object.entries(XAM_BASELINE_V1).reverse())
    expect(resolveRuleset(reversed)).toBe(XAM_BASELINE_V1)
  })
})
