import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AzureTranslateError, translateWithAzure, resetTokenCache } from '../azure-translate'

describe('translateWithAzure', () => {
  let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

  beforeEach(() => {
    resetTokenCache()
    fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetTokenCache()
  })

  function mockText(text: string): Response {
    return {
      ok: true,
      status: 200,
      text: async () => text,
      json: async () => ({}),
    } as unknown as Response
  }

  function mockOk(data: unknown): Response {
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => data,
    } as unknown as Response
  }

  function mockStatus(status: number): Response {
    return {
      ok: false,
      status,
      text: async () => '',
      json: async () => ({}),
    } as unknown as Response
  }

  function makeAzureResponse(translatedText: string, detectedLang = 'en'): unknown {
    return [
      {
        translations: [{ text: translatedText }],
        detectedLanguage: { language: detectedLang },
      },
    ]
  }

  // -------------------------------------------------------------------------
  // Success paths
  // -------------------------------------------------------------------------

  it('fetches auth token then translates successfully', async () => {
    fetchMock.mockResolvedValueOnce(mockText('test-jwt-token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Bonjour')))
    const result = await translateWithAzure('Hello', 'fr')
    expect(result.translatedText).toBe('Bonjour')
    expect(result.provider).toBe('Azure')
    expect(result.detectedSourceLang).toBe('en')
  })

  it('sends auth token in Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(mockText('my-token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
    await translateWithAzure('Hello', 'es')
    const translateCall = fetchMock.mock.calls[1]!
    const init = translateCall[1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token')
  })

  it('sends correct target language in URL', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
    await translateWithAzure('Hello', 'es')
    const translateUrl = fetchMock.mock.calls[1]![0] as string
    expect(translateUrl).toContain('to=es')
    expect(translateUrl).toContain('api-version=3.0')
  })

  it('sends text as POST body with Text field', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
    await translateWithAzure('Hello', 'es')
    const init = fetchMock.mock.calls[1]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual([{ Text: 'Hello' }])
  })

  it('uses detectedSourceLang from response', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola', 'fr')))
    const result = await translateWithAzure('Bonjour', 'es')
    expect(result.detectedSourceLang).toBe('fr')
  })

  it('falls back to "auto" when detectedLanguage is missing from response', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([{ translations: [{ text: 'Hola' }] }]))
    const result = await translateWithAzure('Hello', 'es')
    expect(result.detectedSourceLang).toBe('auto')
  })

  it('falls back to "auto" when detectedLanguage.language is not a string', async () => {
    fetchMock
      .mockResolvedValueOnce(mockText('token'))
      .mockResolvedValueOnce(mockOk([{ translations: [{ text: 'Hola' }], detectedLanguage: { language: 42 } }]))
    const result = await translateWithAzure('Hello', 'es')
    expect(result.detectedSourceLang).toBe('auto')
  })

  // -------------------------------------------------------------------------
  // Token caching
  // -------------------------------------------------------------------------

  it('reuses cached token within TTL without fetching again', async () => {
    fetchMock
      .mockResolvedValueOnce(mockText('cached-token'))
      .mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
      .mockResolvedValueOnce(mockOk(makeAzureResponse('Hola2')))

    await translateWithAzure('Hello', 'es')
    await translateWithAzure('World', 'es')

    // auth token fetch only called once
    const authCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('translate/auth'))
    expect(authCalls).toHaveLength(1)
  })

  it('invalidates token on 401 response and clears cache', async () => {
    fetchMock.mockResolvedValueOnce(mockText('bad-token')).mockResolvedValueOnce(mockStatus(401))
    await expect(translateWithAzure('Hello', 'es')).rejects.toThrow('Auth token rejected (401)')

    // after 401, cache should be cleared — next call fetches a new token
    fetchMock.mockResolvedValueOnce(mockText('new-token')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
    const result = await translateWithAzure('Hello', 'es')
    expect(result.translatedText).toBe('Hola')
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('translate/auth'))).toHaveLength(2)
  })

  it('resetTokenCache forces re-fetch on next call', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token-1')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola')))
    await translateWithAzure('Hello', 'es')

    resetTokenCache()
    fetchMock.mockResolvedValueOnce(mockText('token-2')).mockResolvedValueOnce(mockOk(makeAzureResponse('Hola2')))
    await translateWithAzure('Hello', 'es')

    const authCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('translate/auth'))
    expect(authCalls).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // Auth error paths
  // -------------------------------------------------------------------------

  it('throws AzureTranslateError when auth endpoint returns non-OK status', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(503))
    const err = await translateWithAzure('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AzureTranslateError)
    expect((err as AzureTranslateError).message).toContain('Auth HTTP 503')
  })

  it('throws AzureTranslateError when auth endpoint returns empty token', async () => {
    fetchMock.mockResolvedValueOnce(mockText('   '))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('Empty auth token')
  })

  it('throws AzureTranslateError when auth fetch throws a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const err = await translateWithAzure('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AzureTranslateError)
    expect((err as AzureTranslateError).message).toContain('Auth network error')
  })

  // -------------------------------------------------------------------------
  // Translation error paths
  // -------------------------------------------------------------------------

  it('throws AzureTranslateError on non-OK translate response', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockStatus(500))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('HTTP 500')
  })

  it('throws AzureTranslateError when translate network fetch throws', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockRejectedValueOnce(new Error('network'))
    const err = await translateWithAzure('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AzureTranslateError)
    expect((err as AzureTranslateError).message).toContain('Network error')
  })

  it('throws AzureTranslateError when response is not an array', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk({ error: 'bad' }))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow(AzureTranslateError)
  })

  it('throws AzureTranslateError when response is empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([]))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('Unexpected response shape')
  })

  it('throws AzureTranslateError when translations array is empty', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([{ translations: [] }]))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('No translations in response')
  })

  it('throws AzureTranslateError when translations is missing', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([{ other: 'data' }]))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('No translations in response')
  })

  it('throws AzureTranslateError when translated text is empty string', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([{ translations: [{ text: '' }] }]))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('Empty translated text')
  })

  it('throws AzureTranslateError when translated text is not a string', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce(mockOk([{ translations: [{ text: null }] }]))
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow('Empty translated text')
  })

  it('throws AzureTranslateError when JSON parsing fails', async () => {
    fetchMock.mockResolvedValueOnce(mockText('token')).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json')
      },
    } as unknown as Response)
    await expect(translateWithAzure('Hello', 'fr')).rejects.toThrow(AzureTranslateError)
  })

  it('error has name AzureTranslateError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const err = await translateWithAzure('Hello', 'fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AzureTranslateError)
    expect((err as AzureTranslateError).name).toBe('AzureTranslateError')
  })
})
