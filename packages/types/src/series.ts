import type { BookCard } from "./book";

export type SeriesSummary = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
};

export type SeriesPage = {
  items: SeriesSummary[];
  total: number;
  page: number;
  size: number;
};

export type SeriesDetail = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  possibleGaps: number[];
  /** Total books a metadata provider reports for the series, or null when no provider has told us. */
  expectedBookCount: number | null;
};

export type SeriesLibraryItem = BookCard;

export type SeriesBooksPage = {
  items: SeriesLibraryItem[];
  total: number;
  page: number;
  size: number;
  seriesInfo: SeriesDetail;
};
