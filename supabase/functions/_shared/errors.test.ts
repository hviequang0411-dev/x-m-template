import { describe, expect, it } from 'vitest'
import { API_ERRORS, ApiError, errorEnvelope, isApiErrorCode, mapDbError } from './errors.ts'
import { MOVE_ERROR_CODES } from './game-engine/state.ts'

describe('API errors', () => {
  it('includes every engine error code', () => {
    for (const code of MOVE_ERROR_CODES) expect(isApiErrorCode(code)).toBe(true)
  })

  it('uses the ARCHITECTURE §8 status classes', () => {
    expect(API_ERRORS.INVALID_REQUEST.status).toBe(400)
    expect(API_ERRORS.UNAUTHORIZED.status).toBe(401)
    expect(API_ERRORS.NOT_ROOM_HOST.status).toBe(403)
    expect(API_ERRORS.ROOM_NOT_FOUND.status).toBe(404)
    expect(API_ERRORS.VERSION_CONFLICT.status).toBe(409)
    expect(API_ERRORS.INTERNAL_ERROR.status).toBe(500)
    for (const { message } of Object.values(API_ERRORS)) expect(message.length).toBeGreaterThan(0)
  })

  it('builds the envelope with the Vietnamese message', () => {
    expect(errorEnvelope('NOT_YOUR_TURN')).toEqual({
      ok: false,
      error: { code: 'NOT_YOUR_TURN', message: 'Chưa đến lượt bạn' },
    })
  })

  it('isApiErrorCode rejects unknown and inherited keys', () => {
    expect(isApiErrorCode('ROOM_FULL')).toBe(true)
    expect(isApiErrorCode('NOPE')).toBe(false)
    expect(isApiErrorCode('toString')).toBe(false)
    expect(isApiErrorCode(42)).toBe(false)
  })

  it('ApiError carries its code', () => {
    expect(new ApiError('ROOM_FULL').code).toBe('ROOM_FULL')
  })
})

describe('mapDbError', () => {
  it.each([
    [{ code: 'P0001', message: 'VERSION_CONFLICT' }, 'VERSION_CONFLICT'],
    [{ code: 'P0001', message: 'ROOM_FULL' }, 'ROOM_FULL'],
    [{ code: 'P0001', message: ' NOT_ROOM_HOST ' }, 'NOT_ROOM_HOST'],
    [{ code: 'P0001', message: 'SOMETHING_ELSE' }, 'INTERNAL_ERROR'],
    [{ code: 'P0001', message: 'toString' }, 'INTERNAL_ERROR'],
    [
      { code: '23505', message: 'duplicate key value violates unique constraint "game_actions_match_version_key"' },
      'VERSION_CONFLICT',
    ],
    [
      { code: '23505', message: 'duplicate key value violates unique constraint "game_actions_match_action_key"' },
      'ACTION_ALREADY_PROCESSED',
    ],
    [{ code: '23505', message: 'x', details: 'Key violates "room_players_one_active_room_key"' }, 'ALREADY_IN_ROOM'],
    [{ code: '23505', message: 'duplicate key on "some_other_key"' }, 'INTERNAL_ERROR'],
    [{ code: '42501', message: 'permission denied for function apply_game_action' }, 'INTERNAL_ERROR'],
    [{ code: 'PGRST202', message: 'Could not find the function' }, 'INTERNAL_ERROR'],
    [{}, 'INTERNAL_ERROR'],
    [null, 'INTERNAL_ERROR'],
  ])('%j → %s', (error, expected) => {
    expect(mapDbError(error)).toBe(expected)
  })
})
