import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { flattenCatalog, validateCatalogs } from './locale-catalog-validation.mjs'

const API = 'https://api.crowdin.com/api/v2'
const SOURCE_PATH_SUFFIX = '/client/src/locales/en.json'
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CATALOG_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const clientRoot = path.basename(process.cwd()) === 'client' ? process.cwd() : path.join(process.cwd(), 'client')
const localesDirectory = path.join(clientRoot, 'src/locales')

export const TARGET_CATALOGS = [
  { languageId: 'cs', locale: 'cs' },
  { languageId: 'da', locale: 'da' },
  { languageId: 'de', locale: 'de' },
  { languageId: 'es-ES', locale: 'es' },
  { languageId: 'fi', locale: 'fi' },
  { languageId: 'fr', locale: 'fr' },
  { languageId: 'it', locale: 'it' },
  { languageId: 'nl', locale: 'nl' },
  { languageId: 'pl', locale: 'pl' },
  { languageId: 'pt-BR', locale: 'pt' },
  { languageId: 'ru', locale: 'ru' },
  { languageId: 'sl', locale: 'sl' },
  { languageId: 'sv-SE', locale: 'sv' },
  { languageId: 'uk', locale: 'uk' },
  { languageId: 'zh-CN', locale: 'zh' },
]

const TARGET_LOCALES = new Set(TARGET_CATALOGS.map(({ locale }) => locale))

async function responseText(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} bytes`)
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`Response exceeds ${maxBytes} bytes`)
    }
    chunks.push(Buffer.from(value))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text, context) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${context} returned invalid JSON`)
  }
}

function assertSafeDownloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Crowdin export URL must use HTTPS')

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80:')
  ) {
    throw new Error('Crowdin export URL must not target a local network host')
  }

  const octets = hostname.split('.').map(Number)
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    const [first, second] = octets
    if (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    ) {
      throw new Error('Crowdin export URL must not target a local network host')
    }
  }

  return url
}

async function downloadCatalog(fetchImpl, value) {
  let url = assertSafeDownloadUrl(value)

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) throw new Error('Crowdin export exceeded the redirect limit')
      url = assertSafeDownloadUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) throw new Error(`Crowdin export download failed with HTTP ${response.status}`)
    return parseJson(await responseText(response, MAX_CATALOG_BYTES), 'Crowdin export')
  }

  throw new Error('Crowdin export exceeded the redirect limit')
}

export function createCrowdinClient({ token, projectId, fetchImpl = fetch }) {
  async function request(endpoint, init = {}) {
    const response = await fetchImpl(`${API}${endpoint}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await responseText(response, MAX_API_RESPONSE_BYTES)
    if (!response.ok) throw new Error(`Crowdin API ${endpoint} failed with HTTP ${response.status}: ${body.slice(0, 300)}`)
    return body ? parseJson(body, `Crowdin API ${endpoint}`) : null
  }

  return {
    async sourceFileId() {
      for (let offset = 0; offset < 10_000; offset += 500) {
        const page = await request(`/projects/${projectId}/files?limit=500&offset=${offset}`)
        const match = page.data.find((entry) => entry.data.path.endsWith(SOURCE_PATH_SUFFIX))
        if (match) return match.data.id
        if (page.data.length < 500) break
      }
      throw new Error(`Crowdin source file ending in ${SOURCE_PATH_SUFFIX} was not found`)
    },

    async sourceIdentifiers(fileId) {
      const identifiers = new Set()
      for (let offset = 0; offset < 20_000; offset += 500) {
        const page = await request(`/projects/${projectId}/strings?fileId=${fileId}&limit=500&offset=${offset}`)
        for (const entry of page.data) identifiers.add(entry.data.identifier)
        if (page.data.length < 500) return identifiers
      }
      throw new Error('Crowdin source contains more than 20,000 messages')
    },

    async exportedCatalog(fileId, languageId) {
      const build = await request(`/projects/${projectId}/translations/builds/files/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguageId: languageId, skipUntranslatedStrings: true }),
      })
      return downloadCatalog(fetchImpl, build.data.url)
    },
  }
}

function orderedSparseCatalog(reference, messages, prefix = '') {
  const output = {}
  for (const [key, child] of Object.entries(reference)) {
    const messageKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') {
      const translated = messages.get(messageKey)
      if (translated) output[key] = translated
      continue
    }

    const nested = orderedSparseCatalog(child, messages, messageKey)
    if (Object.keys(nested).length > 0) output[key] = nested
  }
  return output
}

export function normalizeCrowdinCatalog(exported, reference) {
  const referenceMessages = flattenCatalog(reference)
  const exportedMessages = flattenCatalog(exported)

  for (const key of exportedMessages.keys()) {
    if (!referenceMessages.has(key)) throw new Error(`Crowdin export contains unknown key ${key}`)
  }
  for (const [key, message] of exportedMessages) {
    if (message.length === 0) exportedMessages.delete(key)
  }

  return orderedSparseCatalog(reference, exportedMessages)
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

export function sourceDrift(referenceMessages, identifiers) {
  const missing = [...referenceMessages.keys()].filter((key) => !identifiers.has(key))
  const unexpected = [...identifiers].filter((key) => !referenceMessages.has(key))
  return { missing, unexpected }
}

export function parseAllowedTranslationLosses(value = '') {
  const allowed = new Set()
  for (const entry of value.split(/[\s,]+/).filter(Boolean)) {
    const separator = entry.indexOf(':')
    const locale = entry.slice(0, separator)
    const key = entry.slice(separator + 1)
    if (separator < 1 || !TARGET_LOCALES.has(locale) || !/^[A-Za-z0-9_.-]+$/.test(key)) {
      throw new Error(`Invalid translation loss acknowledgement ${entry}; expected locale:message.key`)
    }
    if (allowed.has(entry)) throw new Error(`Duplicate translation loss acknowledgement ${entry}`)
    allowed.add(entry)
  }
  return allowed
}

export function findTranslationLosses({ locale, reference, current, exported }) {
  const legacyComplete = current.size === reference.size && [...reference.keys()].every((key) => current.has(key))
  const losses = []

  for (const [key, currentMessage] of current) {
    const referenceMessage = reference.get(key)
    if (referenceMessage === undefined || (legacyComplete && currentMessage === referenceMessage)) continue

    const exportedMessage = exported.get(key)
    if (exportedMessage === undefined) {
      losses.push({ locale, key, reason: 'missing from Crowdin export' })
    } else if (currentMessage !== referenceMessage && exportedMessage === referenceMessage) {
      losses.push({ locale, key, reason: 'replaced by English source text' })
    }
  }

  return losses
}

export function assertTranslationRetention({ reference, currentCatalogs, exportedCatalogs, allowedLosses = new Set() }) {
  const losses = []
  for (const { locale } of TARGET_CATALOGS) {
    const current = currentCatalogs.get(locale)
    const exported = exportedCatalogs.get(locale)
    if (!current || !exported) throw new Error(`Translation retention comparison is missing the ${locale} catalog`)
    losses.push(...findTranslationLosses({ locale, reference, current, exported }))
  }

  const detected = new Set(losses.map(({ locale, key }) => `${locale}:${key}`))
  const unacknowledged = losses.filter(({ locale, key }) => !allowedLosses.has(`${locale}:${key}`))
  const unused = [...allowedLosses].filter((entry) => !detected.has(entry))
  if (unacknowledged.length === 0 && unused.length === 0) return

  const details = [
    ...unacknowledged.slice(0, 25).map(({ locale, key, reason }) => `${locale}:${key} - ${reason}`),
    ...unused.slice(0, 25).map((entry) => `${entry} - acknowledgement does not match an exported loss`),
  ]
  const remaining = unacknowledged.length + unused.length - details.length
  if (remaining > 0) details.push(`...and ${remaining} more`)
  throw new Error(`Crowdin export would lose existing translations:\n${details.join('\n')}`)
}

export async function syncCrowdinTranslations({
  token,
  projectId = '912891',
  fetchImpl = fetch,
  catalogDirectory = localesDirectory,
  outputDirectory = catalogDirectory,
  allowedLosses = new Set(),
}) {
  if (!token) throw new Error('CROWDIN_TOKEN is required')

  const reference = JSON.parse(await readFile(path.join(catalogDirectory, 'en.json'), 'utf8'))
  const referenceMessages = flattenCatalog(reference)
  const currentCatalogs = new Map(
    await Promise.all(
      TARGET_CATALOGS.map(async ({ locale }) => {
        const catalog = JSON.parse(await readFile(path.join(catalogDirectory, `${locale}.json`), 'utf8'))
        return [locale, flattenCatalog(catalog)]
      }),
    ),
  )
  const client = createCrowdinClient({ token, projectId, fetchImpl })
  const fileId = await client.sourceFileId()
  const identifiers = await client.sourceIdentifiers(fileId)
  const drift = sourceDrift(referenceMessages, identifiers)
  if (drift.missing.length > 0 || drift.unexpected.length > 0) {
    const details = [
      ...drift.missing.slice(0, 10).map((key) => `missing in Crowdin: ${key}`),
      ...drift.unexpected.slice(0, 10).map((key) => `missing in Git: ${key}`),
    ]
    throw new Error(`Crowdin source is not synchronized with en.json\n${details.join('\n')}`)
  }

  const downloaded = await mapWithConcurrency(TARGET_CATALOGS, 4, async ({ languageId, locale }) => ({
    locale,
    catalog: normalizeCrowdinCatalog(await client.exportedCatalog(fileId, languageId), reference),
  }))
  const catalogs = new Map([['en', referenceMessages]])
  for (const { locale, catalog } of downloaded) catalogs.set(locale, flattenCatalog(catalog))

  const errors = validateCatalogs({ catalogs })
  if (errors.length > 0) throw new Error(`Crowdin export validation failed:\n${errors.join('\n')}`)
  assertTranslationRetention({
    reference: referenceMessages,
    currentCatalogs,
    exportedCatalogs: catalogs,
    allowedLosses,
  })

  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(
    downloaded.map(({ locale, catalog }) => writeFile(path.join(outputDirectory, `${locale}.json`), `${JSON.stringify(catalog, null, 2)}\n`)),
  )
  console.log(`Synchronized ${downloaded.length} sparse translation catalogs from Crowdin`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncCrowdinTranslations({
    token: process.env.CROWDIN_TOKEN,
    projectId: process.env.CROWDIN_PROJECT_ID || undefined,
    allowedLosses: parseAllowedTranslationLosses(process.env.CROWDIN_ALLOWED_TRANSLATION_LOSSES),
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
