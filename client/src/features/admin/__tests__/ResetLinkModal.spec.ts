import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResetLinkModal from '../ResetLinkModal.vue'

const copyToClipboardMock = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: copyToClipboardMock,
}))

describe('ResetLinkModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    copyToClipboardMock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows copied feedback after a successful copy', async () => {
    const wrapper = mount(ResetLinkModal, {
      props: { resetUrl: 'http://bookorbit.test/reset' },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy')
      ?.trigger('click')

    expect(copyToClipboardMock).toHaveBeenCalledWith('http://bookorbit.test/reset')
    expect(wrapper.text()).toContain('Copied!')

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('Copy')
    expect(wrapper.text()).not.toContain('Copied!')
  })

  it('shows failure feedback when copy fails', async () => {
    copyToClipboardMock.mockResolvedValue(false)
    const wrapper = mount(ResetLinkModal, {
      props: { resetUrl: 'http://bookorbit.test/reset' },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy')
      ?.trigger('click')

    expect(wrapper.text()).toContain('Copy failed')

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('Copy')
    expect(wrapper.text()).not.toContain('Copy failed')
  })
})
