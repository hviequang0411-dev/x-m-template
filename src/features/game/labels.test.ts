import { COMBINATION_TYPES, MOVE_ERROR_CODES } from '@engine'
import { COMBINATION_LABEL, MOVE_ERROR_MESSAGE } from './labels'

it('has a Vietnamese message for every engine error code', () => {
  for (const code of MOVE_ERROR_CODES) expect(MOVE_ERROR_MESSAGE[code]).toBeTruthy()
  expect(Object.keys(MOVE_ERROR_MESSAGE).sort()).toEqual([...MOVE_ERROR_CODES].sort())
})

it('has a label for every combination type', () => {
  expect(Object.keys(COMBINATION_LABEL).sort()).toEqual([...COMBINATION_TYPES].sort())
})
