const CATALOG_EBOOK_PREFIX = 'boce_';
const CATALOG_EBOOK_RE = /^boce_(\d+)$/;

export function encodeKoboCatalogEbookId(catalogItemId: number): string {
  return `${CATALOG_EBOOK_PREFIX}${catalogItemId}`;
}

export function decodeKoboCatalogEbookId(value: string): number | null {
  const match = CATALOG_EBOOK_RE.exec(value);
  if (!match) return null;

  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
