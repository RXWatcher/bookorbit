import { stripBearerPrefix, toBearerAuthorization, unwrapQuotedValue } from './bearer-token.utils';

describe('unwrapQuotedValue', () => {
  it('returns trimmed value when no quotes wrap it', () => {
    expect(unwrapQuotedValue('  token  ')).toBe('token');
  });

  it('returns trimmed value when shorter than two characters', () => {
    expect(unwrapQuotedValue('"')).toBe('"');
    expect(unwrapQuotedValue(' ')).toBe('');
  });

  it('strips matching double quotes', () => {
    expect(unwrapQuotedValue('"abc"')).toBe('abc');
  });

  it('strips matching single quotes', () => {
    expect(unwrapQuotedValue("'abc'")).toBe('abc');
  });

  it('does not strip mismatched quote pairs', () => {
    expect(unwrapQuotedValue('"abc\'')).toBe(`"abc'`);
  });

  it('does not strip when only one side is quoted', () => {
    expect(unwrapQuotedValue('"abc')).toBe('"abc');
    expect(unwrapQuotedValue("abc'")).toBe("abc'");
  });
});

describe('stripBearerPrefix', () => {
  it('returns the token unchanged when no prefix is present', () => {
    expect(stripBearerPrefix('abc-123')).toBe('abc-123');
  });

  it('strips a leading bearer prefix (case-insensitive)', () => {
    expect(stripBearerPrefix('Bearer abc-123')).toBe('abc-123');
    expect(stripBearerPrefix('bearer abc-123')).toBe('abc-123');
    expect(stripBearerPrefix('BEARER abc-123')).toBe('abc-123');
  });

  it('handles wrapped quotes before and after the bearer prefix', () => {
    expect(stripBearerPrefix('"Bearer abc-123"')).toBe('abc-123');
    expect(stripBearerPrefix("'Bearer abc-123'")).toBe('abc-123');
    expect(stripBearerPrefix('Bearer "abc-123"')).toBe('abc-123');
  });

  it('returns empty string for empty input', () => {
    expect(stripBearerPrefix('')).toBe('');
    expect(stripBearerPrefix('   ')).toBe('');
  });
});

describe('toBearerAuthorization', () => {
  it('prefixes a bare token with Bearer', () => {
    expect(toBearerAuthorization('abc-123')).toBe('Bearer abc-123');
  });

  it('does not duplicate an existing Bearer prefix', () => {
    expect(toBearerAuthorization('Bearer abc-123')).toBe('Bearer abc-123');
  });

  it('normalizes quoted bearer input', () => {
    expect(toBearerAuthorization('"Bearer abc-123"')).toBe('Bearer abc-123');
  });
});
