import { ABS_MAX_PAGE, ABS_MAX_PAGE_SIZE, clampAbsPagination } from './abs-pagination.util';

describe('clampAbsPagination', () => {
  it('passes ordinary client pagination through untouched', () => {
    expect(clampAbsPagination(100, 3)).toEqual({ limit: 100, page: 3, offset: 300 });
    expect(clampAbsPagination(50, 0)).toEqual({ limit: 50, page: 0, offset: 0 });
  });

  it('caps a limit that would ask Postgres for the whole table', () => {
    expect(clampAbsPagination(1_000_000_000, 0).limit).toBe(ABS_MAX_PAGE_SIZE);
  });

  it('caps a page that would overflow the SQL offset', () => {
    const { page, offset } = clampAbsPagination(500, 1e20);
    expect(page).toBe(ABS_MAX_PAGE);
    expect(Number.isSafeInteger(offset)).toBe(true);
  });

  it('collapses negative, NaN and non-finite values to zero rather than erroring', () => {
    expect(clampAbsPagination(-5, -1)).toEqual({ limit: 0, page: 0, offset: 0 });
    expect(clampAbsPagination(Number.NaN, Number.NaN)).toEqual({ limit: 0, page: 0, offset: 0 });
    expect(clampAbsPagination(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toEqual({ limit: 0, page: 0, offset: 0 });
  });

  it('reports no offset when the client asked for no limit', () => {
    expect(clampAbsPagination(0, 9).offset).toBe(0);
  });

  it('floors fractional values so they stay valid SQL arguments', () => {
    expect(clampAbsPagination(10.9, 2.7)).toEqual({ limit: 10, page: 2, offset: 20 });
  });
});
