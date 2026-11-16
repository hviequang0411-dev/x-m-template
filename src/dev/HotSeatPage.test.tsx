import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMatchState, type CardCode } from '@engine'
import { useSelectionStore } from '@/features/game/selectionStore'
import { HotSeatPage } from './HotSeatPage'

const hands = [['3S', '9S'], ['4H', 'KD'], ['5D', 'QC'], ['6C', 'AH']] as CardCode[][]

beforeEach(() => useSelectionStore.setState({ selected: [] }))

function setup() {
  render(<HotSeatPage initialState={createMatchState(hands, 0)} />)
  return userEvent.setup()
}

describe('<HotSeatPage>', () => {
  it('refuses a pass from the leader with a Vietnamese message', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Bỏ lượt' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Bạn đang dẫn vòng nên không được bỏ lượt')
  })

  it('plays CCW and shows an invalid-combination error', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: '3 bích' }))
    await user.click(screen.getByRole('button', { name: 'Đánh' }))
    expect(screen.getByText('Lượt của ghế 3')).toBeInTheDocument()
    expect(screen.getByText('Ghế 0 đánh Lẻ: 3S')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'A cơ' }))
    await user.click(screen.getByRole('button', { name: '6 chuồn' }))
    expect(screen.getByText('Chưa phải bộ hợp lệ')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Đánh' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Các lá đã chọn không tạo thành bộ hợp lệ')
  })

  it('plays a whole match to a winner', async () => {
    const user = setup()
    const playOne = async (card: string) => {
      await user.click(screen.getByRole('button', { name: card }))
      await user.click(screen.getByRole('button', { name: 'Đánh' }))
    }
    const pass = () => user.click(screen.getByRole('button', { name: 'Bỏ lượt' }))
    await playOne('3 bích') // seat 0
    await playOne('6 chuồn') // seat 3
    await playOne('Q chuồn') // seat 2
    await playOne('K rô') // seat 1
    await pass() // seat 0
    await playOne('A cơ') // seat 3: last card
    expect(screen.getAllByText(/Ghế 3 thắng/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Đánh' })).not.toBeInTheDocument()
  })
})
