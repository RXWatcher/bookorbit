import type { DictionaryDefinition, DictionaryEntry, DictionaryResult } from '@bookorbit/types'

const LANGUAGE_ALIASES: Record<string, string> = {
  ar: 'ar',
  ara: 'ar',
  arabic: 'ar',
  cs: 'cs',
  ces: 'cs',
  cze: 'cs',
  czech: 'cs',
  da: 'da',
  dan: 'da',
  danish: 'da',
  de: 'de',
  deu: 'de',
  ger: 'de',
  german: 'de',
  el: 'el',
  ell: 'el',
  gre: 'el',
  greek: 'el',
  en: 'en',
  eng: 'en',
  english: 'en',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  fi: 'fi',
  fin: 'fi',
  finnish: 'fi',
  fr: 'fr',
  fra: 'fr',
  fre: 'fr',
  french: 'fr',
  he: 'he',
  heb: 'he',
  hebrew: 'he',
  hi: 'hi',
  hin: 'hi',
  hindi: 'hi',
  hu: 'hu',
  hun: 'hu',
  hungarian: 'hu',
  id: 'id',
  ind: 'id',
  indonesian: 'id',
  it: 'it',
  ita: 'it',
  italian: 'it',
  ja: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kor: 'ko',
  korean: 'ko',
  nl: 'nl',
  nld: 'nl',
  dut: 'nl',
  dutch: 'nl',
  no: 'no',
  nor: 'no',
  norwegian: 'no',
  pl: 'pl',
  pol: 'pl',
  polish: 'pl',
  pt: 'pt',
  por: 'pt',
  portuguese: 'pt',
  ro: 'ro',
  ron: 'ro',
  rum: 'ro',
  romanian: 'ro',
  ru: 'ru',
  rus: 'ru',
  russian: 'ru',
  sv: 'sv',
  swe: 'sv',
  swedish: 'sv',
  th: 'th',
  tha: 'th',
  thai: 'th',
  tr: 'tr',
  tur: 'tr',
  turkish: 'tr',
  uk: 'uk',
  ukr: 'uk',
  ukrainian: 'uk',
  vi: 'vi',
  vie: 'vi',
  vietnamese: 'vi',
  zh: 'zh',
  zho: 'zh',
  chi: 'zh',
  chinese: 'zh',
}

function stripHtml(html: string): string {
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim()
}

function normalizeLang(lang: string): string {
  if (!lang) return 'en'
  const normalized = lang.trim().toLowerCase()
  if (!normalized) return 'en'

  const primary = normalized.split(/[;,/|]/)[0]?.trim() ?? ''
  if (!primary) return 'en'

  const base = primary.split('-')[0]?.trim() ?? ''
  const alias = LANGUAGE_ALIASES[base]
  if (alias) return alias

  if (/^[a-z]{2,3}$/.test(base)) return base

  return 'en'
}

function extractPhonetics(entry: Record<string, unknown>): { phonetic: string | null; audioUrl: string | null } {
  let phonetic = (entry['phonetic'] as string | undefined) ?? null
  let audioUrl: string | null = null

  const phonetics = entry['phonetics'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(phonetics)) {
    for (const p of phonetics) {
      const audio = typeof p['audio'] === 'string' ? p['audio'] : null
      const text = typeof p['text'] === 'string' && p['text'] ? p['text'] : null
      if (audio) {
        audioUrl = audio
        if (text) phonetic = text
        break
      }
      if (!phonetic && text) {
        phonetic = text
      }
    }
  }

  return { phonetic, audioUrl }
}

function parseMeanings(meanings: Array<Record<string, unknown>>): DictionaryEntry[] {
  return meanings.map((m) => {
    const partOfSpeech = typeof m['partOfSpeech'] === 'string' ? m['partOfSpeech'] : ''
    const rawDefs = Array.isArray(m['definitions']) ? (m['definitions'] as Array<Record<string, unknown>>) : []
    const definitions: DictionaryDefinition[] = rawDefs.map((d) => ({
      definition: typeof d['definition'] === 'string' ? d['definition'] : '',
      example: typeof d['example'] === 'string' ? d['example'] : null,
    }))
    return { partOfSpeech, definitions }
  })
}

async function fetchFreeDictionary(word: string): Promise<DictionaryResult | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Free Dictionary API error: ${res.status}`)

  const data: unknown = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null

  const entry = data[0] as Record<string, unknown>
  const { phonetic, audioUrl } = extractPhonetics(entry)
  const meanings = Array.isArray(entry['meanings']) ? (entry['meanings'] as Array<Record<string, unknown>>) : []
  const entries = parseMeanings(meanings)

  if (entries.length === 0) return null

  return {
    word: typeof entry['word'] === 'string' ? entry['word'] : word,
    phonetic,
    audioUrl,
    entries,
    provider: 'free-dictionary',
  }
}

function parseWiktionaryEntries(data: Record<string, unknown>): DictionaryEntry[] {
  const entries: DictionaryEntry[] = []

  for (const langEntries of Object.values(data)) {
    if (!Array.isArray(langEntries)) continue
    for (const entry of langEntries) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const partOfSpeech = typeof e['partOfSpeech'] === 'string' ? e['partOfSpeech'] : ''
      const rawDefs = Array.isArray(e['definitions']) ? (e['definitions'] as Array<Record<string, unknown>>) : []
      const definitions: DictionaryDefinition[] = []

      for (const d of rawDefs) {
        const def = typeof d['definition'] === 'string' ? stripHtml(d['definition']) : ''
        if (!def) continue
        const rawExamples = Array.isArray(d['examples']) ? (d['examples'] as unknown[]) : []
        let example: string | null = null
        for (const ex of rawExamples) {
          if (typeof ex === 'string') {
            example = stripHtml(ex)
            break
          } else if (ex && typeof ex === 'object') {
            const t = (ex as Record<string, unknown>)['text']
            if (typeof t === 'string') {
              example = stripHtml(t)
              break
            }
          }
        }
        definitions.push({ definition: def, example })
      }

      if (definitions.length > 0) {
        entries.push({ partOfSpeech, definitions })
      }
    }
  }

  return entries
}

async function fetchWiktionary(word: string, lang: string): Promise<DictionaryResult | null> {
  const res = await fetch(`https://${encodeURIComponent(lang)}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Wiktionary API error: ${res.status}`)

  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') return null

  const entries = parseWiktionaryEntries(data as Record<string, unknown>)
  if (entries.length === 0) return null

  return {
    word,
    phonetic: null,
    audioUrl: null,
    entries,
    provider: 'wiktionary',
  }
}

export function useDictionary() {
  async function lookup(word: string, lang: string): Promise<DictionaryResult | null> {
    const normalizedLang = normalizeLang(lang)
    const trimmed = word.trim()

    if (normalizedLang === 'en') {
      let result: DictionaryResult | null = null
      try {
        result = await fetchFreeDictionary(trimmed)
      } catch {
        // Fall back to Wiktionary on any Free Dictionary error
      }
      if (result) return result
      return fetchWiktionary(trimmed, normalizedLang)
    }

    return fetchWiktionary(trimmed, normalizedLang)
  }

  return { lookup }
}
