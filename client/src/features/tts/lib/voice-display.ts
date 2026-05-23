import type { TtsVoice } from '@bookorbit/types'

export function formatVoiceDisplayName(voice: TtsVoice): string {
  const base = voice.name.split(' - ')[0] ?? voice.name
  const withoutMicrosoft = base.replace(/^Microsoft\s+/i, '')
  const withoutNatural = withoutMicrosoft.replace(/\s+Online\s+\(Natural\)\s*$/i, '')
  return withoutNatural.trim() || voice.shortName || voice.id
}

export function formatVoiceLocaleLabel(voice: TtsVoice): string {
  const parsed = parseVoiceLanguageCountry(voice)
  return parsed.countryName ? `${parsed.languageName} (${parsed.countryName})` : parsed.languageName
}

export function parseVoiceLanguageCountry(voice: TtsVoice): { languageName: string; countryName: string } {
  const parsed = parseLanguageCountryFromFriendlyName(voice.name) ?? parseLanguageCountryFromLocale(voice.locale)
  return parsed
}

function parseLanguageCountryFromFriendlyName(name: string): { languageName: string; countryName: string } | null {
  const separator = name.lastIndexOf(' - ')
  if (separator < 0) return null
  const localePart = name.slice(separator + 3).trim()
  const countryStart = localePart.lastIndexOf(' (')
  if (countryStart < 0 || !localePart.endsWith(')')) return null
  const languageName = localePart.slice(0, countryStart).trim()
  const countryName = localePart.slice(countryStart + 2, -1).trim()
  if (!languageName || !countryName) return null
  return { languageName, countryName }
}

function parseLanguageCountryFromLocale(locale: string): { languageName: string; countryName: string } {
  const languageDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null
  const regionDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

  let languageCode = locale
  let regionCode = ''
  try {
    const parsed = new Intl.Locale(locale)
    languageCode = parsed.language ?? locale
    regionCode = parsed.region ?? ''
  } catch {
    const [language = locale, region = ''] = locale.split('-')
    languageCode = language
    regionCode = region
  }
  const languageName = languageDisplayNames?.of(languageCode) ?? languageCode
  const countryName = regionCode ? (regionDisplayNames?.of(regionCode) ?? regionCode) : ''
  return { languageName, countryName }
}
