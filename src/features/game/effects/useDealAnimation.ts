import { useCallback, useEffect, useRef, useState } from 'react'
import { playSound } from '@/lib/sound'

const STORAGE_PREFIX = 'xam_dealt_'
const CARDS_PER_PLAYER = 10

function isReducedMotionOrTestEnv(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

function hasDealtBefore(matchId: string): boolean {
  try {
    return window.sessionStorage.getItem(`${STORAGE_PREFIX}${matchId}`) === '1'
  } catch {
    return false
  }
}

function markDealt(matchId: string): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${matchId}`, '1')
  } catch {
    // Ignore storage quota/privacy mode restrictions.
  }
}

export interface DealAnimationState {
  dealing: boolean
  step: number
  totalSteps: number
  skip: () => void
}

/**
 * Orchestrates a one-time round-robin dealing animation at the start of each match.
 * Plays 10 cards per seated player over ~1.6–2.1 seconds, throttles deal sound cues,
 * locks action buttons briefly until complete, and can be skipped on any click/tap.
 */
export function useDealAnimation(
  matchId: string,
  status: 'PLAYING' | 'FINISHED' | 'ABORTED' | undefined,
  version: number | undefined,
  playerCount: number,
): DealAnimationState {
  const [dealing, setDealing] = useState(false)
  const [step, setStep] = useState(0)
  const totalSteps = Math.max(0, playerCount * CARDS_PER_PLAYER)
  const lastSoundAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const startedMatchRef = useRef<string | null>(null)

  const skip = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (matchId) markDealt(matchId)
    setDealing(false)
    setStep(totalSteps)
  }, [matchId, totalSteps])

  // Whether a fresh match is on screen. Once the deal has started it must run to the end even if this
  // turns false (another player moves during the deal and `version` goes up), so the timer below is
  // only cancelled on unmount or when another match is shown, never by a version change.
  const canStart = Boolean(matchId) && status === 'PLAYING' && version !== undefined && version <= 2 && playerCount >= 2

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        // Interrupted mid-deal (unmount, StrictMode's dev re-mount, or the next match in the same room):
        // forget that it started so a re-mount deals again; it is only marked dealt once it finishes.
        window.clearTimeout(timerRef.current)
        timerRef.current = null
        startedMatchRef.current = null
      }
      setDealing(false)
      setStep(0)
    }
  }, [matchId])

  useEffect(() => {
    if (!canStart) return
    if (startedMatchRef.current === matchId) return
    startedMatchRef.current = matchId
    if (hasDealtBefore(matchId) || isReducedMotionOrTestEnv()) {
      markDealt(matchId)
      return
    }

    const count = playerCount * CARDS_PER_PLAYER
    const stepMs = Math.min(78, Math.max(40, Math.round(1620 / count)))
    const flightSettleMs = 280
    let current = 0

    const advance = () => {
      if (current === 0) {
        setDealing(true)
      }
      current += 1
      setStep(current)

      const now = Date.now()
      if (now - lastSoundAtRef.current >= 95) {
        lastSoundAtRef.current = now
        playSound('deal')
      }

      if (current < count) {
        timerRef.current = window.setTimeout(advance, stepMs)
      } else {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          markDealt(matchId)
          setDealing(false)
        }, flightSettleMs)
      }
    }

    timerRef.current = window.setTimeout(advance, 20)
    // No cleanup here on purpose: see `canStart` above. The [matchId] effect cancels the timer.
  }, [matchId, canStart, playerCount])

  useEffect(() => {
    if (!dealing) return
    const onPointerDown = () => skip()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') skip()
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true, once: true })
    window.addEventListener('keydown', onKeyDown, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dealing, skip])

  return { dealing, step, totalSteps, skip }
}
