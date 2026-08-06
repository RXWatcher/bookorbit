import { sanitizeLogValue } from './log-sanitize.utils';

describe('sanitizeLogValue', () => {
  it('returns the value unchanged when it has no special characters', () => {
    expect(sanitizeLogValue('hello world')).toBe('hello world');
  });

  it('replaces carriage return with a space', () => {
    expect(sanitizeLogValue('line1\rline2')).toBe('line1 line2');
  });

  it('replaces newline with a space', () => {
    expect(sanitizeLogValue('line1\nline2')).toBe('line1 line2');
  });

  it('replaces tab with a space', () => {
    expect(sanitizeLogValue('col1\tcol2')).toBe('col1 col2');
  });

  it('replaces CRLF log-injection payload characters with spaces', () => {
    const payload = 'value\r\nINFO [injected] fake=log';
    expect(sanitizeLogValue(payload)).toBe('value  INFO [injected] fake=log');
  });

  it('escapes backslash', () => {
    expect(sanitizeLogValue('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes double quote', () => {
    expect(sanitizeLogValue('say "hello"')).toBe('say \\"hello\\"');
  });

  it('escapes backslash before double quote (correct order)', () => {
    expect(sanitizeLogValue('path\\"value')).toBe('path\\\\\\"value');
  });

  it('escapes both backslash and double quote together', () => {
    expect(sanitizeLogValue('C:\\Users\\name "Nick"')).toBe('C:\\\\Users\\\\name \\"Nick\\"');
  });

  it('truncates to default max length before escaping', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeLogValue(long);
    expect(result).toHaveLength(200);
  });

  it('truncates to custom max length', () => {
    const result = sanitizeLogValue('abcdefgh', 4);
    expect(result).toBe('abcd');
  });

  it('does not truncate a value at exactly max length', () => {
    const exact = 'a'.repeat(200);
    expect(sanitizeLogValue(exact)).toBe(exact);
  });

  it('preserves empty string', () => {
    expect(sanitizeLogValue('')).toBe('');
  });

  it('accepts a number and converts to string', () => {
    expect(sanitizeLogValue(42)).toBe('42');
  });

  it('accepts null and converts to string', () => {
    expect(sanitizeLogValue(null)).toBe('null');
  });

  it('accepts undefined and converts to string', () => {
    expect(sanitizeLogValue(undefined)).toBe('undefined');
  });

  it('accepts an Error object and uses its string representation', () => {
    const err = new Error('disk full');
    expect(sanitizeLogValue(err)).toBe('Error: disk full');
  });

  it('handles unicode characters without modification', () => {
    expect(sanitizeLogValue('cafe\u0301')).toBe('cafe\u0301');
  });

  it('handles null byte by preserving it (not a control char in the replaced set)', () => {
    expect(sanitizeLogValue('before\x00after')).toBe('before\x00after');
  });
});
