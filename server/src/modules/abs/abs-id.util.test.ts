import { decodeWarehouseBookId, encodeWarehouseBookId } from '../warehouse/warehouse-book-card.mapper';
import { decodeAbsId, encodeAbsId } from './abs-id.util';

describe('abs-id.util', () => {
  it('round-trips ids per type', () => {
    expect(decodeAbsId('library', encodeAbsId('library', 42))).toBe(42);
    expect(decodeAbsId('libraryItem', encodeAbsId('libraryItem', 7))).toBe(7);
    expect(decodeAbsId('user', encodeAbsId('user', 1))).toBe(1);
  });

  it('produces namespaced, non-colliding ids for the same integer', () => {
    expect(encodeAbsId('library', 1)).not.toBe(encodeAbsId('libraryItem', 1));
    // Decoding with the wrong type prefix must fail rather than silently mismatch.
    expect(decodeAbsId('libraryItem', encodeAbsId('library', 1))).toBeNull();
  });

  // The source-backed libraries are virtual and negative (-1/-2/-3), so these have to round-trip.
  it('round-trips the negative ids the virtual warehouse libraries use', () => {
    expect(encodeAbsId('library', -1)).toBe('lib_-1');
    expect(decodeAbsId('library', encodeAbsId('library', -1))).toBe(-1);
    expect(decodeAbsId('library', encodeAbsId('library', -3))).toBe(-3);
  });

  // Warehouse catalog items live in the negative book id space (see encodeWarehouseBookId), so a
  // warehouse item id has to survive the ABS round trip as faithfully as a native one.
  it('round-trips the negative synthetic ids warehouse items use', () => {
    const warehouseBookId = encodeWarehouseBookId('ebook', 123);
    expect(warehouseBookId).toBeLessThan(0);
    expect(decodeAbsId('libraryItem', encodeAbsId('libraryItem', warehouseBookId))).toBe(warehouseBookId);
    expect(decodeWarehouseBookId(decodeAbsId('libraryItem', encodeAbsId('libraryItem', warehouseBookId))!)).toEqual({
      mediaType: 'ebook',
      catalogItemId: 123,
    });
  });

  it('rejects malformed or hostile input', () => {
    expect(decodeAbsId('library', undefined)).toBeNull();
    expect(decodeAbsId('library', '')).toBeNull();
    expect(decodeAbsId('library', 'lib_')).toBeNull();
    expect(decodeAbsId('library', 'lib_abc')).toBeNull();
    expect(decodeAbsId('library', 'lib_0')).toBeNull();
    expect(decodeAbsId('library', 'lib_-0')).toBeNull();
    expect(decodeAbsId('library', 'lib_1.5')).toBeNull();
    expect(decodeAbsId('library', 'lib_-1.5')).toBeNull();
    expect(decodeAbsId('library', 'lib_--1')).toBeNull();
    expect(decodeAbsId('library', '42')).toBeNull();
  });
});
