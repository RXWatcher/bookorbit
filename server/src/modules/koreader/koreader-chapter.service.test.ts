import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KoreaderChapterService } from './koreader-chapter.service';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

describe('KoreaderChapterService', () => {
  let service: KoreaderChapterService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KoreaderChapterService();
  });

  describe('parseChapterIndexFromProgress', () => {
    it('returns null for null, undefined, and empty strings', () => {
      expect(service.parseChapterIndexFromProgress(null)).toBeNull();
      expect(service.parseChapterIndexFromProgress(undefined)).toBeNull();
      expect(service.parseChapterIndexFromProgress('')).toBeNull();
    });

    it('parses body DocFragment paths into zero-based chapter indices', () => {
      expect(service.parseChapterIndexFromProgress('/body/DocFragment[3]/body/section[1]/p[1]')).toBe(2);
    });

    it('parses DocFragment[1] as chapter index 0', () => {
      expect(service.parseChapterIndexFromProgress('DocFragment[1]')).toBe(0);
    });

    it('parses larger DocFragment values correctly', () => {
      expect(service.parseChapterIndexFromProgress('/body/DocFragment[15]/body/p[2]')).toBe(14);
    });

    it('returns null for non-matching progress strings', () => {
      expect(service.parseChapterIndexFromProgress('/body/p[2]')).toBeNull();
    });

    it('returns null for malformed progress strings', () => {
      expect(service.parseChapterIndexFromProgress('DocFragment[]')).toBeNull();
      expect(service.parseChapterIndexFromProgress('/body/DocFragment[abc]/body/p[1]')).toBeNull();
    });
  });

  describe('parseChapterIndexFromCfi', () => {
    it('returns null for null, undefined, and empty strings', () => {
      expect(service.parseChapterIndexFromCfi(null)).toBeNull();
      expect(service.parseChapterIndexFromCfi(undefined)).toBeNull();
      expect(service.parseChapterIndexFromCfi('')).toBeNull();
    });

    it('parses chapter CFIs into zero-based chapter indices', () => {
      expect(service.parseChapterIndexFromCfi('epubcfi(/6/4[chapter01]!/4/2)')).toBe(1);
    });

    it('parses the first chapter CFI as chapter index 0', () => {
      expect(service.parseChapterIndexFromCfi('epubcfi(/6/2!/4/1:0)')).toBe(0);
    });

    it('parses larger spine positions correctly', () => {
      expect(service.parseChapterIndexFromCfi('epubcfi(/6/10!/4/2)')).toBe(4);
    });

    it('returns null for non-matching CFI strings', () => {
      expect(service.parseChapterIndexFromCfi('/6/4[chapter01]!/4/2')).toBeNull();
    });

    it('returns null for malformed CFI strings', () => {
      expect(service.parseChapterIndexFromCfi('epubcfi(/6/x!/4/2)')).toBeNull();
      expect(service.parseChapterIndexFromCfi('epubcfi(/foo)')).toBeNull();
    });
  });
});
