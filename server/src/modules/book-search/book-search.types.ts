export type BookSearchSource = 'catalog' | 'native';

export interface BookSearchDocument {
  id: string;
  source: BookSearchSource;
  mediaType: string;
  title: string;
  sortTitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  tags: string[];
  genres: string[];
  identifiers: string[];
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  libraryId: number | null;
  addedAt: number | null;
}

export interface BookSearchQuery {
  q: string;
  page: number;
  size: number;
  mediaTypes?: string[];
  libraryIds?: number[];
}

export interface BookSearchPage {
  ids: string[];
  total: number;
  page: number;
  size: number;
}

export interface BookSearchProvider {
  readonly name: 'meilisearch' | 'sql';
  isAvailable(): Promise<boolean>;
  search(query: BookSearchQuery): Promise<BookSearchPage>;
}
