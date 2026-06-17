export interface AnnotationItem {
  id: number;
  bookId: number;
  cfi: string;
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AnnotationStats {
  totalHighlights: number;
  colorBreakdown: { color: string; count: number }[];
  chaptersWithHighlights: number;
  highlightsWithNotes: number;
  chapters: string[];
}

export interface AnnotationListResponse {
  items: AnnotationItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: AnnotationStats;
}
