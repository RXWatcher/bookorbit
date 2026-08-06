import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationResult } from '../../services/translation.types'

vi.mock('../../services/google-translate', () => ({
  translateWithGoogle: vi.fn<(text: string, targetLang: string) => Promise<TranslationResult>>(),
  GoogleTranslateError: class GoogleTranslateError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'GoogleTranslateError'
    }
  },
}))

vi.mock('../../services/azure-translate', () => ({
  translateWithAzure: vi.fn<(text: string, targetLang: string) => Promise<TranslationResult>>(),
  resetTokenCache: vi.fn<() => void>(),
  AzureTranslateError: class AzureTranslateError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'AzureTranslateError'
    }
  },
}))

import { translateWithGoogle } from '../../services/google-translate'
import { translateWithAzure } from '../../services/azure-translate'
import { SUPPORTED_LANGUAGES, TRANSLATION_CHAR_LIMIT } from '../../services/translation.types'

const mockGoogle = vi.mocked(translateWithGoogle)
const mockAzure = vi.mocked(translateWithAzure)

const GOOGLE_SUCCESS: TranslationResult = { translatedText: 'Bonjour', detectedSourceLang: 'en', provider: 'Google' }
const AZURE_SUCCESS: TranslationResult = { translatedText: 'Salut', detectedSourceLang: 'en', provider: 'Azure' }

async function loadComposable() {
  const mod = await import('../useTranslation')
  return mod.useTranslation()
}

function makeLocalStorageMock(getItemImpl: (() => string | null) | (string | null) = null, setItemImpl?: () => void): Storage {
  const getItem =
    typeof getItemImpl === 'function'
      ? vi.fn<(key: string) => string | null>().mockImplementation(getItemImpl)
      : vi.fn<(key: string) => string | null>().mockReturnValue(getItemImpl)

  const setItem = setItemImpl
    ? vi.fn<(key: string, value: string) => void>().mockImplementation(setItemImpl)
    : vi.fn<(key: string, value: string) => void>()

  return { getItem, setItem, removeItem: vi.fn<(key: string) => void>() } as unknown as Storage
}

describe('useTranslation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageMock())
    mockGoogle.mockReset()
    mockAzure.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts with loading=false, error=null, result=null', async () => {
    const { loading, error, result } = await loadComposable()
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(result.value).toBeNull()
  })

  it('exposes supportedLanguages matching the types constant', async () => {
    const { supportedLanguages } = await loadComposable()
    expect(supportedLanguages).toStrictEqual(SUPPORTED_LANGUAGES)
  })

  // -------------------------------------------------------------------------
  // Language persistence
  // -------------------------------------------------------------------------

  it('defaults to "en" when localStorage has no stored value', async () => {
    const { targetLang } = await loadComposable()
    expect(targetLang.value).toBe('en')
  })

  it('reads persisted lang from localStorage on init', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock('fr'))
    const { targetLang } = await loadComposable()
    expect(targetLang.value).toBe('fr')
  })

  it('falls back to "en" when localStorage returns an unsupported lang code', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock('xx'))
    const { targetLang } = await loadComposable()
    expect(targetLang.value).toBe('en')
  })

  it('falls back to "en" when localStorage.getItem throws', async () => {
    vi.stubGlobal(
      'localStorage',
      makeLocalStorageMock(() => {
        throw new Error('unavailable')
      }),
    )
    const { targetLang } = await loadComposable()
    expect(targetLang.value).toBe('en')
  })

  it('setTargetLang updates targetLang and persists to localStorage', async () => {
    const setItemMock = vi.fn<(key: string, value: string) => void>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn<(key: string) => string | null>().mockReturnValue(null),
      setItem: setItemMock,
      removeItem: vi.fn<(key: string) => void>(),
    } as unknown as Storage)
    const { targetLang, setTargetLang } = await loadComposable()
    setTargetLang('ja')
    expect(targetLang.value).toBe('ja')
    expect(setItemMock).toHaveBeenCalledWith('translation_target_lang', 'ja')
  })

  it('setTargetLang does not throw when localStorage.setItem throws', async () => {
    vi.stubGlobal(
      'localStorage',
      makeLocalStorageMock(null, () => {
        throw new Error('quota exceeded')
      }),
    )
    const { setTargetLang } = await loadComposable()
    expect(() => setTargetLang('de')).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // Character limit
  // -------------------------------------------------------------------------

  it('sets error and skips API calls when text exceeds limit', async () => {
    const { translate, error, result, loading } = await loadComposable()
    const longText = 'a'.repeat(TRANSLATION_CHAR_LIMIT + 1)
    await translate(longText, 'fr')
    expect(error.value).toMatch(/too long/i)
    expect(result.value).toBeNull()
    expect(loading.value).toBe(false)
    expect(mockGoogle).not.toHaveBeenCalled()
    expect(mockAzure).not.toHaveBeenCalled()
  })

  it('accepts text exactly at the character limit', async () => {
    mockGoogle.mockResolvedValueOnce(GOOGLE_SUCCESS)
    const { translate, error } = await loadComposable()
    const exactText = 'a'.repeat(TRANSLATION_CHAR_LIMIT)
    await translate(exactText, 'fr')
    expect(error.value).toBeNull()
    expect(mockGoogle).toHaveBeenCalled()
  })

  it('sets error when trimmed text is empty', async () => {
    const { translate, error } = await loadComposable()
    await translate('   ', 'fr')
    expect(error.value).toMatch(/nothing to translate/i)
    expect(mockGoogle).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Google success path
  // -------------------------------------------------------------------------

  it('returns Google result on success', async () => {
    mockGoogle.mockResolvedValueOnce(GOOGLE_SUCCESS)
    const { translate, result, loading, error } = await loadComposable()
    await translate('Hello', 'fr')
    expect(result.value).toEqual(GOOGLE_SUCCESS)
    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('sets loading=true during translation then false after', async () => {
    const states: boolean[] = []
    let resolve!: (r: typeof GOOGLE_SUCCESS) => void
    mockGoogle.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res
      }),
    )
    const { translate, loading } = await loadComposable()
    const translatePromise = translate('Hello', 'fr')
    states.push(loading.value)
    resolve(GOOGLE_SUCCESS)
    await translatePromise
    states.push(loading.value)
    expect(states).toEqual([true, false])
  })

  it('trims whitespace from input before calling APIs', async () => {
    mockGoogle.mockResolvedValueOnce(GOOGLE_SUCCESS)
    const { translate } = await loadComposable()
    await translate('  Hello  ', 'fr')
    expect(mockGoogle).toHaveBeenCalledWith('Hello', 'fr')
  })

  // -------------------------------------------------------------------------
  // Azure fallback
  // -------------------------------------------------------------------------

  it('falls back to Azure when Google throws', async () => {
    mockGoogle.mockRejectedValueOnce(new Error('google fail'))
    mockAzure.mockResolvedValueOnce(AZURE_SUCCESS)
    const { translate, result, error } = await loadComposable()
    await translate('Hello', 'fr')
    expect(result.value).toEqual(AZURE_SUCCESS)
    expect(error.value).toBeNull()
    expect(mockAzure).toHaveBeenCalledWith('Hello', 'fr')
  })

  it('sets error when both Google and Azure throw', async () => {
    mockGoogle.mockRejectedValueOnce(new Error('google fail'))
    mockAzure.mockRejectedValueOnce(new Error('azure fail'))
    const { translate, result, error, loading } = await loadComposable()
    await translate('Hello', 'fr')
    expect(result.value).toBeNull()
    expect(error.value).toMatch(/translation failed/i)
    expect(loading.value).toBe(false)
  })

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  it('reset() clears result, error, and loading state', async () => {
    mockGoogle.mockResolvedValueOnce(GOOGLE_SUCCESS)
    const { translate, reset, result, error, loading } = await loadComposable()
    await translate('Hello', 'fr')
    expect(result.value).not.toBeNull()
    reset()
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Subsequent calls clear previous state
  // -------------------------------------------------------------------------

  it('clears previous result and error at the start of a new translate call', async () => {
    mockGoogle.mockRejectedValueOnce(new Error('fail'))
    mockAzure.mockRejectedValueOnce(new Error('fail'))
    const { translate, error, result } = await loadComposable()
    await translate('Hello', 'fr')
    expect(error.value).not.toBeNull()

    mockGoogle.mockResolvedValueOnce(GOOGLE_SUCCESS)
    await translate('World', 'es')
    expect(error.value).toBeNull()
    expect(result.value).toEqual(GOOGLE_SUCCESS)
  })
})
