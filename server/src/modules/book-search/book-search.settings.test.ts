import { BookSearchSettingsService } from './book-search.settings';

function makeDb(stored: string | null) {
  const rows = stored === null ? [] : [{ key: 'book_search_config', value: stored }];
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return {
    db: {
      query: { appSettings: { findFirst: vi.fn().mockResolvedValue(rows[0]) } },
      insert: vi.fn().mockReturnValue({ values }),
    } as never,
    values,
  };
}

const secret = {
  // Uses 'CT' rather than 'ct' as the mock ciphertext: the field name 'activeIndex' contains
  // the lowercase substring 'ct', which would falsely trip the leak check below.
  encrypt: vi.fn().mockReturnValue({ ciphertext: 'CT', nonce: 'n', tag: 't' }),
  decrypt: vi.fn().mockReturnValue('plain-key'),
} as never;

describe('BookSearchSettingsService', () => {
  it('reports defaults when nothing is stored', async () => {
    const { db } = makeDb(null);

    await expect(new BookSearchSettingsService(db, secret).get()).resolves.toEqual({
      enabled: false,
      url: '',
      activeIndex: 'bookorbit_books',
      hasApiKey: false,
    });
  });

  it('never returns the api key from get', async () => {
    const { db } = makeDb(
      JSON.stringify({
        enabled: true,
        url: 'http://m:7700',
        activeIndex: 'i',
        apiKey: { ciphertext: 'CT', nonce: 'n', tag: 't' },
      }),
    );

    const result = await new BookSearchSettingsService(db, secret).get();

    expect(result.hasApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain('CT');
    expect(JSON.stringify(result)).not.toContain('plain-key');
  });

  it('decrypts the api key only through getApiKey', async () => {
    const { db } = makeDb(
      JSON.stringify({
        enabled: true,
        url: 'http://m:7700',
        activeIndex: 'i',
        apiKey: { ciphertext: 'CT', nonce: 'n', tag: 't' },
      }),
    );

    await expect(new BookSearchSettingsService(db, secret).getApiKey()).resolves.toBe('plain-key');
  });

  it('encrypts an api key before storing it', async () => {
    const { db, values } = makeDb(null);

    await new BookSearchSettingsService(db, secret).save({ apiKey: 'new-key' });

    const written = JSON.parse((values.mock.calls[0][0] as { value: string }).value) as Record<string, unknown>;
    expect(written.apiKey).toEqual({ ciphertext: 'CT', nonce: 'n', tag: 't' });
    expect(JSON.stringify(written)).not.toContain('new-key');
  });
});
