import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardCode } from '@engine'
import { useSelectionStore } from '@/features/game/selectionStore'
import { Hand } from './Hand'
import { PlayingCard } from './PlayingCard'
import { parseCard } from '@engine'

const HAND: CardCode[] = ['2D', 'AS', '3H', 'TH', '3S', 'KC', '7D', '9S', 'JH', '5C']

beforeEach(() => useSelectionStore.setState({ selected: [] }))

function cardButtons() {
  return within(screen.getByRole('group')).getAllByRole('button')
}

describe('<Hand>', () => {
  it('shows 10 cards sorted by rank (3 low, 2 high)', () => {
    render(<Hand cards={HAND} />)
    expect(screen.getByRole('group', { name: 'Bài của bạn (10 lá)' })).toBeInTheDocument()
    expect(cardButtons().map((b) => b.getAttribute('data-card'))).toEqual([
      '3S', '3H', '5C', '7D', '9S', 'TH', 'JH', 'KC', 'AS', '2D',
    ])
  })

  it('selects and deselects a card', async () => {
    const user = userEvent.setup()
    render(<Hand cards={HAND} />)
    const ten = screen.getByRole('button', { name: '10 cơ' })
    expect(ten).toHaveAttribute('aria-pressed', 'false')

    await user.click(ten)
    expect(ten).toHaveAttribute('aria-pressed', 'true')
    expect(useSelectionStore.getState().selected).toEqual(['TH'])

    await user.click(screen.getByRole('button', { name: '2 rô' }))
    expect(useSelectionStore.getState().selected).toEqual(['TH', '2D'])

    await user.click(ten)
    expect(ten).toHaveAttribute('aria-pressed', 'false')
    expect(useSelectionStore.getState().selected).toEqual(['2D'])
  })

  it('does not select while disabled', async () => {
    const user = userEvent.setup()
    render(<Hand cards={HAND} disabled />)
    await user.click(screen.getByRole('button', { name: 'A bích' }))
    expect(useSelectionStore.getState().selected).toEqual([])
  })

  it('drops selected cards that leave the hand', () => {
    useSelectionStore.setState({ selected: ['TH', '2D'] })
    const { rerender } = render(<Hand cards={HAND} />)
    rerender(<Hand cards={HAND.filter((c) => c !== '2D')} />)
    expect(useSelectionStore.getState().selected).toEqual(['TH'])
    expect(cardButtons()).toHaveLength(9)
  })

  it('shows an empty state with no cards', () => {
    render(<Hand cards={[]} />)
    expect(screen.getByText('Hết bài')).toBeInTheDocument()
  })

  it('rejects invalid card codes from the server', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Hand cards={['ZZ' as CardCode]} />)).toThrow(/INVALID_CARD/)
  })
})

describe('<PlayingCard>', () => {
  it('renders a static card as an image with a Vietnamese label', () => {
    render(<PlayingCard card={parseCard('QD')} />)
    expect(screen.getByRole('img', { name: 'Q rô' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
