import { create } from 'zustand'
import type { CardCode } from '@engine'

interface SelectionState {
  /** Cards the player has tapped. UI state only: the server decides what is playable. */
  selected: CardCode[]
  toggle: (code: CardCode) => void
  clear: () => void
  /** Drops selected cards that are no longer in the hand (after a new server version). */
  keepOnly: (hand: readonly CardCode[]) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: [],
  toggle: (code) =>
    set((s) => ({
      selected: s.selected.includes(code) ? s.selected.filter((c) => c !== code) : [...s.selected, code],
    })),
  clear: () => set({ selected: [] }),
  keepOnly: (hand) =>
    set((s) => {
      const next = s.selected.filter((c) => hand.includes(c))
      return next.length === s.selected.length ? s : { selected: next }
    }),
}))
