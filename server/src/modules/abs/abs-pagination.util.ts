/**
 * Bounds for ABS list pagination.
 *
 * `limit` and `page` arrive as raw query params and, for `GET /api/libraries/:id/items`, flow
 * straight into SQL `LIMIT`/`OFFSET`. Unbounded, `?limit=1000000000` asks Postgres to materialise a
 * billion rows, and `?page=99999999999999999999` overflows the bigint `OFFSET` accepts. Both are
 * reachable by any authenticated client, so the values are clamped before they leave the controller.
 *
 * ABS itself does not clamp, but its clients never ask for more than a few hundred rows: the mobile
 * apps page at 100 and author-centric clients (Prologue) at 50. A ceiling of 500 is well clear of
 * every real client while keeping a single request bounded.
 */
export const ABS_MAX_PAGE_SIZE = 500;

/**
 * Largest `page` we honour. `page * limit` must stay a safe integer *and* a valid Postgres bigint
 * offset; at the maximum page size this caps the offset at 5e8 rows, far past any real library.
 */
export const ABS_MAX_PAGE = 1_000_000;

export interface AbsPagination {
  /** Clamped page size. 0 means "no limit requested": the caller returns the whole set. */
  limit: number;
  /** Clamped page index. */
  page: number;
  /** `page * limit`, safe to pass to SQL OFFSET. */
  offset: number;
}

/**
 * Clamp a raw `limit`/`page` pair into safe bounds. Non-numeric, negative and NaN inputs collapse to
 * 0 rather than erroring, matching ABS's permissive parsing; the difference is only in the ceiling.
 *
 * The clamped values are echoed back in the response envelope so a client that asked for more than
 * the ceiling still pages consistently instead of silently re-reading the same rows.
 */
export function clampAbsPagination(rawLimit: number, rawPage: number): AbsPagination {
  const limit = clamp(rawLimit, ABS_MAX_PAGE_SIZE);
  const page = clamp(rawPage, ABS_MAX_PAGE);
  return { limit, page, offset: limit > 0 ? page * limit : 0 };
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
}
