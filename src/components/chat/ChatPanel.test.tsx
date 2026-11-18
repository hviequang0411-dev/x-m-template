import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatMessage } from '@/features/chat/api'
import { ChatPanel } from './ChatPanel'
import { EmoteBubble } from './EmoteBubble'

const msg = (id: number, userId: string, body: string, kind: ChatMessage['kind'] = 'TEXT'): ChatMessage => ({
  id,
  roomId: 'r1',
  userId,
  displayName: userId === 'u0' ? 'An' : 'Bình',
  kind,
  body,
  createdAt: '2026-11-18T10:00:00Z',
})

function setup(props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const onSendText = vi.fn().mockResolvedValue(true)
  const onSendEmote = vi.fn()
  render(
    <ChatPanel
      messages={[]}
      meId="u0"
      sending={false}
      error={null}
      onSendText={onSendText}
      onSendEmote={onSendEmote}
      {...props}
    />,
  )
  return { user: userEvent.setup(), onSendText, onSendEmote }
}

describe('ChatPanel', () => {
  it('has an empty state', () => {
    setup()
    expect(screen.getByText(/Chưa có tin nhắn/)).toBeInTheDocument()
  })

  it('shows messages, "Bạn" for mine, and emotes by their label', () => {
    setup({ messages: [msg(1, 'u1', 'chào cả nhà'), msg(2, 'u0', 'hi'), msg(3, 'u1', 'hurry', 'EMOTE')] })
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('Bình')
    expect(screen.getByText('chào cả nhà')).toBeInTheDocument()
    expect(screen.getByText('Bạn')).toBeInTheDocument()
    expect(screen.getByText('Nhanh lên!')).toBeInTheDocument()
  })

  it('sends trimmed text and clears the box on success', async () => {
    const { user, onSendText } = setup()
    const input = screen.getByLabelText('Tin nhắn')
    expect(input).toHaveAttribute('maxLength', '200')
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled()
    await user.type(input, '  xin chào  {Enter}')
    expect(onSendText).toHaveBeenCalledWith('xin chào')
    expect(input).toHaveValue('')
  })

  it('keeps the text when sending fails and shows the error', async () => {
    const { user, onSendText } = setup({ error: 'Bạn gửi nhanh quá, chờ vài giây rồi gửi tiếp nhé.' })
    onSendText.mockResolvedValue(false)
    await user.type(screen.getByLabelText('Tin nhắn'), 'spam')
    await user.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(screen.getByLabelText('Tin nhắn')).toHaveValue('spam')
    expect(screen.getByRole('alert')).toHaveTextContent('gửi nhanh quá')
  })

  it('counts characters', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Tin nhắn'), 'abc')
    expect(screen.getByText('3/200')).toBeInTheDocument()
  })

  it('sends an emote with one click; buttons are disabled while sending', async () => {
    const { user, onSendEmote } = setup()
    await user.click(screen.getByRole('button', { name: 'Gửi biểu cảm: Hay!' }))
    expect(onSendEmote).toHaveBeenCalledWith('nice')
  })

  it('disables emotes while sending', () => {
    setup({ sending: true })
    expect(screen.getByRole('button', { name: 'Gửi biểu cảm: GG' })).toBeDisabled()
  })
})

describe('EmoteBubble', () => {
  it('announces who sent which emote', () => {
    render(<EmoteBubble code="happy" name="Bình" />)
    expect(screen.getByRole('status', { name: 'Bình: Vui quá' })).toHaveTextContent('😄')
  })

  it('renders nothing for an unknown code', () => {
    const { container } = render(<EmoteBubble code="dance" name="Bình" />)
    expect(container).toBeEmptyDOMElement()
  })
})
