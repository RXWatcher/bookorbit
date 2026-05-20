import { describe, it, expect } from 'vitest';
import { normalizePath } from './tts-text-extractor.service';

describe('normalizePath', () => {
  it('returns a simple path unchanged', () => {
    expect(normalizePath('OEBPS/Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('collapses one .. segment', () => {
    expect(normalizePath('OEBPS/../Text/ch1.xhtml')).toBe('Text/ch1.xhtml');
  });

  it('collapses leading directory plus .. (epub relative href pattern)', () => {
    expect(normalizePath('OEBPS/../Text/chapter1.xhtml')).toBe('Text/chapter1.xhtml');
  });

  it('handles multiple .. segments', () => {
    expect(normalizePath('a/b/c/../../d.xhtml')).toBe('a/d.xhtml');
  });

  it('handles . segments', () => {
    expect(normalizePath('OEBPS/./Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('returns empty string for pure .. navigation', () => {
    expect(normalizePath('../ch1.xhtml')).toBe('ch1.xhtml');
  });

  it('handles no directory prefix', () => {
    expect(normalizePath('chapter1.xhtml')).toBe('chapter1.xhtml');
  });
});
