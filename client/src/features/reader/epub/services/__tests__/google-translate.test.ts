import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleTranslateError, translateWithGoogle } from '../google-translate'

const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single'

describe('translateWithGoogle', () => {
  let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

  beforeEach(() => {
    fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mockOk(data: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => data,
    } as unknown as Response
  }

  function mockStatus(status: number): Response {
    return {
      ok: false,
      status,
      json: async () => ({}),
    } as unknown as Response
  }

  function makeGoogleResponse(sentences: unknown[][], detectedLang = 'en'): unknown {
    return [sentences, null, detectedLang]
  }

  // -------------------------------------------------------------------------
  // Success paths
  // -------------------------------------------------------------------------

  it('returns translated text from a single-sentence response', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeGoogleResponse([['Bonjour', 'Hello', null, null, 10]], 'en')))
    const result = await translateWithGoogle('Hello', 'fr')
    expect(result.translatedText).toBe('Bonjour')
    expect(result.provider).toBe('Google')
    expect(result.detectedSourceLang).toBe('en')
  })

  it('concatenates multiple sentences into a single string', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk(
        makeGoogleResponse(
          [
            ['Bonjour', 'Hello', null],
            [' monde', ' world', null],
          ],
          'en',
        ),
      ),
    )
    const result = await translateWithGoogle('Hello world', 'fr')
    expect(result.translatedText).toBe('Bonjour monde')
  })

  it('uses "auto" as detectedSourceLang when data[2] is missing', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([[[`Hola`, 'Hello']]]))
    const result = await translateWithGoogle('Hello', 'es')
    expect(result.detectedSourceLang).toBe('auto')
  })

  it('uses "auto" as detectedSourceLang when data[2] is not a string', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([[[`Hola`, 'Hello']], null, 42]))
    const result = await translateWithGoogle('Hello', 'es')
    expect(result.detectedSourceLang).toBe('auto')
  })

  it('builds correct URL with all required query params', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeGoogleResponse([['Hola', 'Hello']], 'en')))
    await translateWithGoogle('Hello', 'es')
    const calledUrl = fetchMock.mock.calls[0]![0] as string
    expect(calledUrl).toContain('client=gtx')
    expect(calledUrl).toContain('sl=auto')
    expect(calledUrl).toContain('tl=es')
    expect(calledUrl).toContain(encodeURIComponent('Hello'))
    expect(calledUrl).toContain(GOOGLE_URL)
  })

  it('encodes special characters in the query text', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeGoogleResponse([['résultat', 'result']], 'en')))
    await translateWithGoogle('café & résumé', 'fr')
    const calledUrl = fetchMock.mock.calls[0]![0] as string
    // URLSearchParams encodes spaces as '+', so decode before asserting
    const decodedUrl = decodeURIComponent(calledUrl.replace(/\+/g, ' '))
    expect(decodedUrl).toContain('café & résumé')
  })

  it('skips sentence entries that are not arrays', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([[['Hello', 'Hi'], null, ['World', 'World']], null, 'en']))
    const result = await translateWithGoogle('Hi World', 'en')
    expect(result.translatedText).toBe('HelloWorld')
  })

  it('skips sentence entries where first element is not a string', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk([
        [
          [42, 'Hello'],
          ['Valid', 'text'],
        ],
        null,
        'en',
      ]),
    )
    const result = await translateWithGoogle('Hello text', 'es')
    expect(result.translatedText).toBe('Valid')
  })

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it('throws GoogleTranslateError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const err = await translateWithGoogle('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoogleTranslateError)
    expect((err as GoogleTranslateError).message).toContain('Network error')
  })

  it('throws GoogleTranslateError on non-OK HTTP status', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(429))
    const err = await translateWithGoogle('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoogleTranslateError)
    expect((err as GoogleTranslateError).message).toContain('HTTP 429')
  })

  it('throws GoogleTranslateError on 500 status', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(500))
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow('HTTP 500')
  })

  it('throws GoogleTranslateError when response is not an array', async () => {
    fetchMock.mockResolvedValueOnce(mockOk({ error: 'bad' }))
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow(GoogleTranslateError)
  })

  it('throws GoogleTranslateError when response is empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([]))
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow(GoogleTranslateError)
  })

  it('throws GoogleTranslateError when data[0] is not an array', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(['not-sentences', null, 'en']))
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow(GoogleTranslateError)
  })

  it('throws GoogleTranslateError when all sentences produce empty string', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([[null, null], null, 'en']))
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow(GoogleTranslateError)
  })

  it('throws GoogleTranslateError when JSON parsing fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid json')
      },
    } as unknown as Response)
    await expect(translateWithGoogle('Hello', 'fr')).rejects.toThrow(GoogleTranslateError)
  })

  it('error has name GoogleTranslateError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const err = await translateWithGoogle('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoogleTranslateError)
    expect((err as GoogleTranslateError).name).toBe('GoogleTranslateError')
  })
})
