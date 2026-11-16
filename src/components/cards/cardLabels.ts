import type { Card, Rank, Suit } from '@engine'

export const RANK_LABEL: Record<Rank, string> = {
  '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A', '2': '2',
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', C: '♣', D: '♦', H: '♥' }
const SUIT_NAME: Record<Suit, string> = { S: 'bích', C: 'chuồn', D: 'rô', H: 'cơ' }

/** Screen-reader label, e.g. "10 cơ". */
export function cardLabel(card: Pick<Card, 'rank' | 'suit'>): string {
  return `${RANK_LABEL[card.rank]} ${SUIT_NAME[card.suit]}`
}
