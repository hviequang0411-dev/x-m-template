import { create } from 'zustand'

const STORAGE_KEY = 'xam_sound_enabled'

export type SoundEffect = 'deal' | 'select' | 'play' | 'pass' | 'turn' | 'tick' | 'win' | 'lose'

function detectDefaultSoundEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
    // Default: enabled on desktop, disabled on mobile (< 640px or coarse pointer)
    if (typeof window.matchMedia === 'function') {
      const isMobile = window.matchMedia('(max-width: 639px), (pointer: coarse)').matches
      return !isMobile
    }
    return true
  } catch {
    return true
  }
}

interface SoundState {
  enabled: boolean
  toggle: () => void
  setEnabled: (val: boolean) => void
}

export const useSoundStore = create<SoundState>((set, get) => ({
  enabled: detectDefaultSoundEnabled(),
  toggle: () => {
    const next = !get().enabled
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Ignore localStorage quota/privacy errors
    }
    set({ enabled: next })
    if (next) {
      userInteracted = true
      playSound('select')
    }
  },
  setEnabled: (val: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(val))
    } catch {
      // Ignore localStorage errors
    }
    set({ enabled: val })
  },
}))

let audioCtx: AudioContext | null = null
let userInteracted = false

function setupInteractionListeners() {
  if (typeof window === 'undefined') return
  const markInteracted = () => {
    userInteracted = true
    window.removeEventListener('pointerdown', markInteracted)
    window.removeEventListener('keydown', markInteracted)
  }
  window.addEventListener('pointerdown', markInteracted, { passive: true, once: true })
  window.addEventListener('keydown', markInteracted, { passive: true, once: true })
}

setupInteractionListeners()

function getAudioContext(): AudioContext | null {
  if (!userInteracted || typeof window === 'undefined') return null
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    if (!audioCtx) {
      audioCtx = new Ctx()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch {
    return null
  }
}

function playTone(
  ctx: AudioContext,
  freqStart: number,
  freqEnd: number,
  duration: number,
  type: OscillatorType = 'sine',
  gainPeak = 0.08,
  delay = 0,
) {
  const start = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqStart, start)
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration)
  }
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(gainPeak, start + Math.min(0.012, duration * 0.25))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.01)
}

function playNoiseSnap(ctx: AudioContext, duration = 0.045, filterFreq = 1600, gainPeak = 0.06, delay = 0) {
  const start = ctx.currentTime + delay
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < sampleCount; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount)
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(filterFreq, start)
  filter.Q.setValueAtTime(1.8, start)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(gainPeak, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  source.start(start)
  source.stop(start + duration + 0.01)
}

/**
 * Plays a short, subtle casino sound effect if sound is enabled and user has interacted.
 * Decorative only: never throws or blocks UI.
 */
export function playSound(effect: SoundEffect): void {
  try {
    if (!useSoundStore.getState().enabled) return
    const ctx = getAudioContext()
    if (!ctx) return

    switch (effect) {
      case 'select': {
        playTone(ctx, 1350, 780, 0.035, 'triangle', 0.05)
        break
      }
      case 'play': {
        playNoiseSnap(ctx, 0.045, 1900, 0.07, 0)
        playTone(ctx, 175, 68, 0.075, 'sine', 0.09, 0.005)
        break
      }
      case 'pass': {
        playTone(ctx, 310, 170, 0.1, 'sine', 0.045)
        break
      }
      case 'deal': {
        for (let i = 0; i < 4; i++) {
          playNoiseSnap(ctx, 0.032, 1500 + i * 180, 0.04, i * 0.045)
        }
        break
      }
      case 'turn': {
        playTone(ctx, 659.25, 659.25, 0.16, 'sine', 0.065, 0)
        playTone(ctx, 880, 880, 0.24, 'sine', 0.075, 0.09)
        break
      }
      case 'tick': {
        playTone(ctx, 980, 720, 0.025, 'triangle', 0.035)
        break
      }
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
        notes.forEach((f, idx) => {
          playTone(ctx, f, f, 0.26, 'triangle', 0.065, idx * 0.08)
        })
        break
      }
      case 'lose': {
        const notes = [392.0, 349.23, 293.66] // G4, F4, D4
        notes.forEach((f, idx) => {
          playTone(ctx, f, f, 0.22, 'sine', 0.05, idx * 0.1)
        })
        break
      }
    }
  } catch {
    // Decorative sound: never break gameplay on audio errors
  }
}
