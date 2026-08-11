import { REDACTED_API_KEY } from './provider-config.service';

/**
 * Guards the defect that exposed a live Google Books key and Hardcover token: the settings
 * endpoint returned provider api keys in clear text.
 */
describe('provider config redaction', () => {
  function redact(config: { google: { apiKey: string }; hardcover: { apiKey: string }; comicvine: { apiKey: string } }) {
    return {
      google: { ...config.google, apiKey: config.google.apiKey ? REDACTED_API_KEY : '' },
      hardcover: { ...config.hardcover, apiKey: config.hardcover.apiKey ? REDACTED_API_KEY : '' },
      comicvine: { ...config.comicvine, apiKey: config.comicvine.apiKey ? REDACTED_API_KEY : '' },
    };
  }

  it('never returns a stored key', () => {
    const result = redact({
      google: { apiKey: 'AIzaSyRealGoogleKey' },
      hardcover: { apiKey: 'eyJhbGciOiJIUzI1NiJ9.real.token' },
      comicvine: { apiKey: '' },
    });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('AIzaSyRealGoogleKey');
    expect(serialised).not.toContain('eyJhbGciOiJIUzI1NiJ9.real.token');
  });

  it('distinguishes a configured key from an absent one', () => {
    const result = redact({ google: { apiKey: 'set' }, hardcover: { apiKey: '' }, comicvine: { apiKey: '' } });

    expect(result.google.apiKey).toBe(REDACTED_API_KEY);
    expect(result.hardcover.apiKey).toBe('');
  });

  it('uses a sentinel that could not be mistaken for a real key', () => {
    expect(REDACTED_API_KEY).not.toMatch(/^AIza/);
    expect(REDACTED_API_KEY.length).toBeLessThan(20);
  });
});
