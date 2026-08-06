import type { GroupRule, SortSpec } from "./query";

export type BookSelectionQuery = {
  libraryId?: number | string;
  filter?: GroupRule;
  q?: string;
  sort?: SortSpec[];
};

export type BookSelectionPayload = { bookIds: number[]; query?: never } | { query: BookSelectionQuery; bookIds?: never };
