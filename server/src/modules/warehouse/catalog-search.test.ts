import { PgDialect } from 'drizzle-orm/pg-core';

import { buildCatalogSearchWhere } from './warehouse.repository';

const dialect = new PgDialect();

function render(term: string): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(buildCatalogSearchWhere(term));
  return { sql: query.sql, params: query.params };
}

/** Distinct bound patterns, since each word is matched against every searchable field. */
function patterns(term: string): string[] {
  return [...new Set(render(term).params.filter((p): p is string => typeof p === 'string'))];
}

describe('buildCatalogSearchWhere', () => {
  it('matches each meaningful word separately, so a missing filler word does not break the search', () => {
    // The reported failure: searching "The Will of Many" found nothing when the catalogue
    // title was "The Will of the Many", because one ILIKE cannot bridge the missing word.
    expect(patterns('The Will of Many')).toEqual(['%Will%', '%Many%']);
  });

  it('ands the words together rather than oring them', () => {
    const { sql } = render('Will Many');

    expect(sql).toContain(' and ');
  });

  it('keeps a single word query as one pattern', () => {
    expect(patterns('Islington')).toEqual(['%Islington%']);
  });

  it('treats a quoted query as one exact phrase', () => {
    expect(patterns('"The Will of Many"')).toEqual(['%The Will of Many%']);
  });

  it('collapses surrounding and repeated whitespace', () => {
    expect(patterns('  will   many  ')).toEqual(['%will%', '%many%']);
  });

  it('matches everything for a blank query rather than nothing', () => {
    expect(render('   ').sql).toContain('true');
  });

  it('caps how many clauses one query can build', () => {
    const term = 'a b c d e f g h i j k l m n o p';

    expect(patterns(term).length).toBeLessThanOrEqual(8);
  });

  it('searches across fields, so an author word and a title word can combine', () => {
    // "islington" should be able to match the author while "many" matches the title.
    const { sql } = render('islington many');

    expect(sql).toContain('title');
    expect(sql).toContain('exists');
  });
});

describe('search word selection', () => {
  it('drops filler words so a title search does not match every book containing "the"', () => {
    // "The Will of the Many" must narrow to the words that carry meaning.
    expect(patterns('The Will of the Many')).toEqual(['%Will%', '%Many%']);
  });

  it('keeps filler words when the query is nothing but filler', () => {
    expect(patterns('the')).toEqual(['%the%']);
  });

  it('still matches a book whose title omits a filler word', () => {
    expect(patterns('The Will of Many')).toEqual(['%Will%', '%Many%']);
  });
});
