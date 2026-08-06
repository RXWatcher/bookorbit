import { Injectable } from '@nestjs/common';

@Injectable()
export class KoreaderChapterService {
  parseChapterIndexFromProgress(progress: string | null | undefined): number | null {
    if (!progress) return null;

    const match = progress.match(/DocFragment\[(\d+)\]/);
    if (match) {
      return parseInt(match[1]!, 10) - 1;
    }

    return null;
  }

  parseChapterIndexFromCfi(cfi: string | null | undefined): number | null {
    if (!cfi) return null;

    const match = cfi.match(/epubcfi\(\/6\/(\d+)/);
    if (match) {
      const spinePos = parseInt(match[1]!, 10);
      return Math.floor(spinePos / 2) - 1;
    }

    return null;
  }
}
