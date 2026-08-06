import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '../clipboard'

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')

function setClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

function setExecCommand(execCommand: (command: string) => boolean) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: vi.fn<(command: string) => boolean>(execCommand),
  })
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}

describe('copyToClipboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    restoreProperty(globalThis.navigator, 'clipboard', originalClipboardDescriptor)
    setExecCommand(() => true)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    restoreProperty(globalThis.navigator, 'clipboard', originalClipboardDescriptor)
    restoreProperty(document, 'execCommand', originalExecCommandDescriptor)
    vi.restoreAllMocks()
  })

  it('uses the Clipboard API when it is available', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    setClipboard(writeText)

    await expect(copyToClipboard('OPDS URL')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('OPDS URL')
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when the Clipboard API is unavailable', async () => {
    restoreProperty(globalThis.navigator, 'clipboard', undefined)
    const execCommand = vi.fn<(command: string) => boolean>((command: string) => {
      expect(command).toBe('copy')
      expect(document.querySelector('textarea')?.value).toBe('HTTP origin URL')
      return true
    })
    setExecCommand(execCommand)

    await expect(copyToClipboard('HTTP origin URL')).resolves.toBe(true)

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'))
    const execCommand = vi.fn<(command: string) => boolean>(() => true)
    setClipboard(writeText)
    setExecCommand(execCommand)

    await expect(copyToClipboard('fallback text')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('fallback text')
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('returns false when no copy strategy succeeds', async () => {
    restoreProperty(globalThis.navigator, 'clipboard', undefined)
    setExecCommand(() => false)

    await expect(copyToClipboard('blocked text')).resolves.toBe(false)
  })

  it('returns false and cleans up when fallback setup fails', async () => {
    restoreProperty(globalThis.navigator, 'clipboard', undefined)
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      throw new Error('append failed')
    })

    await expect(copyToClipboard('blocked setup')).resolves.toBe(false)

    expect(appendChildSpy).toHaveBeenCalled()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('returns false for empty text', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false)

    expect(document.execCommand).not.toHaveBeenCalled()
  })
})
