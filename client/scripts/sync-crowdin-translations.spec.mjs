import { describe, expect, it, vi } from 'vitest'
import {
  TARGET_CATALOGS,
  assertTranslationRetention,
  createCrowdinClient,
  findTranslationLosses,
  normalizeCrowdinCatalog,
  parseAllowedTranslationLosses,
  sourceDrift,
} from './sync-crowdin-translations.mjs'

const reference = {
  common: { save: 'Save', cancel: 'Cancel' },
  books: { count: '{count, plural, one {# book} other {# books}}' },
}

describe('Crowdin translation synchronization', () => {
  it('removes empty untranslated messages and follows English key order', () => {
    const exported = {
      books: { count: '' },
      common: { cancel: 'Zrušit', save: 'Uložit' },
    }

    expect(normalizeCrowdinCatalog(exported, reference)).toEqual({
      common: { save: 'Uložit', cancel: 'Zrušit' },
    })
  })

  it('rejects keys that do not exist in English', () => {
    expect(() => normalizeCrowdinCatalog({ common: { unknown: 'Neznámé' } }, reference)).toThrow('Crowdin export contains unknown key common.unknown')
  })

  it('detects when Crowdin has not synchronized the current English keys', () => {
    expect(sourceDrift(new Map([['common.save', 'Save']]), new Set(['common.cancel']))).toEqual({
      missing: ['common.save'],
      unexpected: ['common.cancel'],
    })
  })

  it('protects real translations in complete legacy catalogs without treating English fallbacks as translations', () => {
    const referenceMessages = new Map([
      ['common.save', 'Save'],
      ['common.cancel', 'Cancel'],
    ])
    const current = new Map([
      ['common.save', 'Uložit'],
      ['common.cancel', 'Cancel'],
    ])
    const exported = new Map()

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'missing from Crowdin export' },
    ])
  })

  it('protects every existing key after a target catalog becomes sparse', () => {
    const referenceMessages = new Map([
      ['common.save', 'Save'],
      ['common.cancel', 'Cancel'],
    ])
    const current = new Map([['common.save', 'Save']])

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported: new Map() })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'missing from Crowdin export' },
    ])
  })

  it('rejects translations that Crowdin replaces with English source text', () => {
    const referenceMessages = new Map([['common.save', 'Save']])
    const current = new Map([['common.save', 'Uložit']])
    const exported = new Map([['common.save', 'Save']])

    expect(findTranslationLosses({ locale: 'cs', reference: referenceMessages, current, exported })).toEqual([
      { locale: 'cs', key: 'common.save', reason: 'replaced by English source text' },
    ])
  })

  it('requires exact acknowledgements for intentional translation losses', () => {
    const referenceMessages = new Map([['common.save', 'Save']])
    const currentCatalogs = new Map(TARGET_CATALOGS.map(({ locale }) => [locale, new Map()]))
    const exportedCatalogs = new Map(TARGET_CATALOGS.map(({ locale }) => [locale, new Map()]))
    currentCatalogs.set('cs', new Map([['common.save', 'Uložit']]))

    expect(() => assertTranslationRetention({ reference: referenceMessages, currentCatalogs, exportedCatalogs })).toThrow(
      'cs:common.save - missing from Crowdin export',
    )
    expect(() =>
      assertTranslationRetention({
        reference: referenceMessages,
        currentCatalogs,
        exportedCatalogs,
        allowedLosses: parseAllowedTranslationLosses('cs:common.save'),
      }),
    ).not.toThrow()
    expect(() =>
      assertTranslationRetention({
        reference: referenceMessages,
        currentCatalogs,
        exportedCatalogs,
        allowedLosses: parseAllowedTranslationLosses('de:common.save'),
      }),
    ).toThrow('de:common.save - acknowledgement does not match an exported loss')
  })

  it('rejects malformed and duplicate loss acknowledgements', () => {
    expect(() => parseAllowedTranslationLosses('xx:common.save')).toThrow('expected locale:message.key')
    expect(() => parseAllowedTranslationLosses('cs:common.save,cs:common.save')).toThrow('Duplicate translation loss acknowledgement')
  })

  it('requests untranslated-string omission and downloads the bounded export', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { url: 'https://downloads.example.test/cs.json' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ common: { save: 'Uložit' } })))
    const client = createCrowdinClient({ token: 'secret', projectId: '42', fetchImpl })

    await expect(client.exportedCatalog(7, 'cs')).resolves.toEqual({ common: { save: 'Uložit' } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.crowdin.com/api/v2/projects/42/translations/builds/files/7')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      targetLanguageId: 'cs',
      skipUntranslatedStrings: true,
    })
  })

  it('rejects private-network export URLs returned by Crowdin', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { url: 'http://127.0.0.1/catalog.json' } })))
    const client = createCrowdinClient({ token: 'secret', projectId: '42', fetchImpl })

    await expect(client.exportedCatalog(7, 'cs')).rejects.toThrow('Crowdin export URL must use HTTPS')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
