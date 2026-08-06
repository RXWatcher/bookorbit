import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FREE_DICT_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/hello'
const WIKTIONARY_EN_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition/hello'
const WIKTIONARY_FR_URL = 'https://fr.wiktionary.org/api/rest_v1/page/definition/bonjour'

function makeFreeDictResponse(word = 'hello', overrides: Record<string, unknown> = {}) {
  return [
    {
      word,
      phonetic: '/həˈloʊ/',
      phonetics: [{ text: '/həˈloʊ/', audio: 'https://audio.example.com/hello.mp3' }, { text: '/hɛˈloʊ/' }],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [{ definition: 'An expression of greeting.', example: 'She said hello.' }, { definition: 'A call to attract attention.' }],
        },
        {
          partOfSpeech: 'verb',
          definitions: [{ definition: 'To greet with "hello".' }],
        },
      ],
      ...overrides,
    },
  ]
}

function makeWiktionaryResponse(overrides: Record<string, unknown> = {}) {
  return {
    en: [
      {
        partOfSpeech: 'Noun',
        definitions: [
          {
            definition: '<span>A greeting</span>.',
            examples: [{ text: '<b>Hello</b> there.' }],
          },
          { definition: 'A call for attention.', examples: [] },
        ],
      },
      ...((overrides['extraEntries'] as unknown[]) ?? []),
    ],
    ...overrides,
  }
}

describe('useDictionary', () => {
  let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

  beforeEach(() => {
    fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function load() {
    const mod = await import('../useDictionary')
    return mod.useDictionary()
  }

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

  // -------------------------------------------------------------------------
  // English - Free Dictionary success path
  // -------------------------------------------------------------------------

  it('English: returns normalized result from Free Dictionary on success', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result).not.toBeNull()
    expect(result!.word).toBe('hello')
    expect(result!.provider).toBe('free-dictionary')
    expect(result!.entries).toHaveLength(2)
    expect(result!.entries[0]!.partOfSpeech).toBe('noun')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('An expression of greeting.')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('She said hello.')
    expect(result!.entries[1]!.partOfSpeech).toBe('verb')
  })

  it('English: extracts phonetic text preferring the entry with audio', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.phonetic).toBe('/həˈloʊ/')
  })

  it('English: extracts audio URL from phonetics', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.audioUrl).toBe('https://audio.example.com/hello.mp3')
  })

  it('English: uses phonetic text from phonetics entry when no top-level phonetic and entry has no audio', async () => {
    const data = makeFreeDictResponse('test', {
      phonetic: undefined,
      phonetics: [{ text: '/tɛst/' }], // text present, no audio
    })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBe('/tɛst/')
    expect(result!.audioUrl).toBeNull()
  })

  it('English: falls back to top-level phonetic when phonetics array has no audio', async () => {
    const data = makeFreeDictResponse('test', {
      phonetic: '/tɛst/',
      phonetics: [{ text: '/tɛst/' }],
    })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBe('/tɛst/')
    expect(result!.audioUrl).toBeNull()
  })

  it('English: phonetic and audioUrl are null when phonetics array is empty and no top-level phonetic', async () => {
    const data = makeFreeDictResponse('test', { phonetic: undefined, phonetics: [] })
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.phonetic).toBeNull()
    expect(result!.audioUrl).toBeNull()
  })

  it('English: definition example is null when not present in Free Dictionary entry', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk(
        makeFreeDictResponse('test', {
          meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A test.' }] }],
        }),
      ),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  // -------------------------------------------------------------------------
  // English - Free Dictionary 404, fallback to Wiktionary
  // -------------------------------------------------------------------------

  it('English: returns null when Free Dictionary entry has no meanings', async () => {
    const data = makeFreeDictResponse('test', { meanings: [] })
    fetchMock.mockResolvedValueOnce(mockOk(data)).mockResolvedValueOnce(mockStatus(404)) // Wiktionary fallback also 404
    const { lookup } = await load()
    const result = await lookup('test', 'en')
    expect(result).toBeNull()
  })

  it('English: uses input word when Free Dictionary word field is not a string', async () => {
    const data = [{ ...makeFreeDictResponse()[0], word: 42 }]
    fetchMock.mockResolvedValueOnce(mockOk(data))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.word).toBe('hello')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns 404', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result).not.toBeNull()
    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe(FREE_DICT_URL)
    expect(fetchMock.mock.calls[1]![0]).toBe(WIKTIONARY_EN_URL)
  })

  it('English: falls back to Wiktionary when Free Dictionary throws a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')

    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('English: falls back to Wiktionary when Free Dictionary returns a non-404 server error', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(500)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockOk([])).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  it('English: falls back to Wiktionary when Free Dictionary returns non-array response', async () => {
    fetchMock.mockResolvedValueOnce(mockOk({ title: 'No Definitions Found' })).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en')
    expect(result!.provider).toBe('wiktionary')
  })

  // -------------------------------------------------------------------------
  // English - both APIs return not found
  // -------------------------------------------------------------------------

  it('English: returns null when both Free Dictionary and Wiktionary return 404', async () => {
    fetchMock.mockResolvedValue(mockStatus(404))
    const { lookup } = await load()
    const result = await lookup('zzzzunknownword', 'en')
    expect(result).toBeNull()
  })

  it('English: returns null when Free Dictionary 404s and Wiktionary returns empty entries', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk({ en: [] }))
    const { lookup } = await load()
    const result = await lookup('zzz', 'en')
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Non-English
  // -------------------------------------------------------------------------

  it('Non-English: calls Wiktionary directly without calling Free Dictionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    await lookup('bonjour', 'fr')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(WIKTIONARY_FR_URL)
  })

  it('Non-English: returns normalized Wiktionary result', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('bonjour', 'fr')

    expect(result).not.toBeNull()
    expect(result!.provider).toBe('wiktionary')
    expect(result!.entries.length).toBeGreaterThan(0)
  })

  it('Non-English: returns null when Wiktionary returns 404', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404))
    const { lookup } = await load()
    const result = await lookup('xyz', 'de')
    expect(result).toBeNull()
  })

  it('Non-English: throws when Wiktionary returns server error', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(500))
    const { lookup } = await load()
    await expect(lookup('xyz', 'de')).rejects.toThrow('Wiktionary API error: 500')
  })

  // -------------------------------------------------------------------------
  // HTML stripping in Wiktionary definitions
  // -------------------------------------------------------------------------

  it('Wiktionary: strips HTML tags from definition strings', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: '<span class="term">A greeting</span> used daily.', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hello', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('A greeting used daily.')
  })

  it('Wiktionary: decodes HTML entities in definitions', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A &amp; B &lt;test&gt; &quot;quoted&quot; &apos;apos&apos;', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe(`A & B <test> "quoted" 'apos'`)
  })

  it('Wiktionary: decodes numeric HTML entities', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'Say &#39;hi&#39;', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.definition).toBe("Say 'hi'")
  })

  it('Wiktionary: strips script tags and their content from definitions', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'Normal text.<script>alert(1)</script>', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    const def = result!.entries[0]!.definitions[0]!.definition
    expect(def).not.toContain('<script>')
    expect(def).not.toContain('</script>')
    expect(def).toContain('Normal text.')
  })

  it('Wiktionary: handles partial/unclosed HTML tags that old regex could not strip', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: '<script src="evil.js"', examples: [] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    // DOMParser parses the partial tag as an HTML element - textContent is empty, so the
    // definition is skipped and there are no entries.
    expect(result).toBeNull()
  })

  it('Wiktionary: trims whitespace-only definitions after stripping', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: '<span>   </span>', examples: [] },
              { definition: 'Valid.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid.')
  })

  it('Wiktionary: strips HTML from example text', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    // Use non-English lang to hit Wiktionary directly (avoiding FreeDictionary fallback complexity)
    const result = await lookup('hello', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('Hello there.')
  })

  it('Wiktionary: handles string example (not object)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: ['<b>Hi</b> there.'] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBe('Hi there.')
  })

  it('Wiktionary: example is null when examples array is empty', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A greeting.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: skips entries with empty definitions after stripping', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: '<span></span>', examples: [] },
              { definition: 'Valid definition.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid definition.')
  })

  it('Wiktionary: treats non-array examples field as no examples', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: 'not an array' }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: skips example object that has no string text field', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: 'A greeting.', examples: [{ text: 42 }, { text: null }] }],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions[0]!.example).toBeNull()
  })

  it('Wiktionary: returns null when response body is not an object', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null } as unknown as Response)
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result).toBeNull()
  })

  it('Wiktionary: skips language sections whose value is not an array', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: 'not-an-array',
        fr: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A greeting.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries).toHaveLength(1)
  })

  it('Wiktionary: skips entries that are not objects', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [null, 'string-entry', { partOfSpeech: 'Noun', definitions: [{ definition: 'Valid.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries).toHaveLength(1)
  })

  it('Wiktionary: treats non-array definitions field as no definitions (entry skipped)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [{ partOfSpeech: 'Noun', definitions: 'not-an-array' }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result).toBeNull()
  })

  it('Wiktionary: skips definition objects where definition field is not a string', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: 42, examples: [] },
              { definition: 'Valid.', examples: [] },
            ],
          },
        ],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('hi', 'fr')
    expect(result!.entries[0]!.definitions).toHaveLength(1)
    expect(result!.entries[0]!.definitions[0]!.definition).toBe('Valid.')
  })

  it('Wiktionary: flattens multiple language sections', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOk({
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'English meaning.', examples: [] }] }],
        fr: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'French meaning.', examples: [] }] }],
      }),
    )
    const { lookup } = await load()
    const result = await lookup('test', 'fr')
    expect(result!.entries).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // Language normalization
  // -------------------------------------------------------------------------

  it('lang normalization: en-US routes to Free Dictionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'en-US')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: fr-FR routes directly to Wiktionary', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    await lookup('bonjour', 'fr-FR')
    expect(fetchMock.mock.calls[0]![0]).toContain('fr.wiktionary.org')
  })

  it('lang normalization: empty string defaults to English (Free Dictionary)', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', '')
    expect(result!.provider).toBe('free-dictionary')
  })

  it('lang normalization: English language name maps to en', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'English')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: ISO-639-2 eng maps to en', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'eng')
    expect(result!.provider).toBe('free-dictionary')
    expect(fetchMock.mock.calls[0]![0]).toContain('api.dictionaryapi.dev')
  })

  it('lang normalization: unknown long language labels fall back to en', async () => {
    fetchMock.mockResolvedValueOnce(mockStatus(404)).mockResolvedValueOnce(mockOk(makeWiktionaryResponse()))
    const { lookup } = await load()
    const result = await lookup('hello', 'some-unknown-language')
    expect(result!.provider).toBe('wiktionary')
    expect(fetchMock.mock.calls[1]![0]).toContain('en.wiktionary.org')
  })

  // -------------------------------------------------------------------------
  // Word trimming
  // -------------------------------------------------------------------------

  it('trims whitespace from the word before lookup', async () => {
    fetchMock.mockResolvedValueOnce(mockOk(makeFreeDictResponse()))
    const { lookup } = await load()
    await lookup('  hello  ', 'en')
    const calledUrl = fetchMock.mock.calls[0]![0] as string
    expect(calledUrl).toContain('/hello')
    expect(calledUrl).not.toContain('%20')
  })
})
