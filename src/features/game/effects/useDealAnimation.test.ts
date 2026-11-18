import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useDealAnimation } from './useDealAnimation'

vi.mock('@/lib/sound', () => ({ playSound: vi.fn() }))

type Props = { matchId: string; version: number }
const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
  // jsdom has no Web Animations API; the hook treats that as "no animation" (tests elsewhere rely on it).
  Element.prototype.animate = vi.fn() as unknown as Element['animate']
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  vi.useRealTimers()
  delete (Element.prototype as Partial<Element>).animate
})

const render = (initial: Props, wrapper?: typeof strict) =>
  renderHook(({ matchId, version }: Props) => useDealAnimation(matchId, 'PLAYING', version, 3), {
    initialProps: initial,
    wrapper,
  })

describe('useDealAnimation', () => {
  it('deals once and unlocks the table at the end', () => {
    const { result } = render({ matchId: 'm1', version: 1 })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.dealing).toBe(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.dealing).toBe(false)
    expect(window.sessionStorage.getItem('xam_dealt_m1')).toBe('1')
  })

  it('a move during the deal (version goes up) does not leave the table locked', () => {
    const { result, rerender } = render({ matchId: 'm1', version: 1 })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.dealing).toBe(true)
    rerender({ matchId: 'm1', version: 3 })
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.dealing).toBe(false)
    expect(result.current.step).toBe(result.current.totalSteps)
  })

  it('still deals under React StrictMode (effects mounted twice in dev)', () => {
    const { result } = render({ matchId: 'm1', version: 1 }, strict)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.dealing).toBe(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.dealing).toBe(false)
  })

  it('does not deal again for a match already dealt (reload)', () => {
    window.sessionStorage.setItem('xam_dealt_m1', '1')
    const { result } = render({ matchId: 'm1', version: 1 })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.dealing).toBe(false)
  })

  it('skip ends the deal at once and remembers it', () => {
    const { result } = render({ matchId: 'm1', version: 1 })
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.skip())
    expect(result.current.dealing).toBe(false)
    expect(window.sessionStorage.getItem('xam_dealt_m1')).toBe('1')
  })

  it('moving to the next match mid-deal resets and deals the new one', () => {
    const { result, rerender } = render({ matchId: 'm1', version: 1 })
    act(() => vi.advanceTimersByTime(300))
    rerender({ matchId: 'm2', version: 1 })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.dealing).toBe(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current.dealing).toBe(false)
    expect(window.sessionStorage.getItem('xam_dealt_m2')).toBe('1')
  })
})
