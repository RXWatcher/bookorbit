import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SubmitWarehouseAudiobookRequestDto, SubmitWarehouseEbookRequestDto } from './warehouse-request.dto';

describe('SubmitWarehouseEbookRequestDto', () => {
  it.each([
    {},
    { preferredFormat: 'EPUB' },
    { isbn: '   ' },
    { searchResult: {} },
    { searchResult: null },
    { isbn: '9780000000001', searchResult: null },
    { isbn: '9780000000001', searchResult: {} },
    { searchResult: [] },
  ])('rejects invalid request target %j', async (input) => {
    await expect(validate(plainToInstance(SubmitWarehouseEbookRequestDto, input))).resolves.not.toHaveLength(0);
  });

  it('does not keep non-contract requestTarget values under whitelist validation', async () => {
    const dto = plainToInstance(SubmitWarehouseEbookRequestDto, { isbn: '9780000000001', requestTarget: 'junk' });

    await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    expect(dto).not.toHaveProperty('requestTarget');
  });

  it('accepts and trims ISBN requests', async () => {
    const dto = plainToInstance(SubmitWarehouseEbookRequestDto, { isbn: ' 9780000000001 ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.isbn).toBe('9780000000001');
  });

  it('accepts search result requests without an ISBN', async () => {
    const dto = plainToInstance(SubmitWarehouseEbookRequestDto, { searchResult: { title: 'Requested Book' } });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

describe('SubmitWarehouseAudiobookRequestDto', () => {
  it.each([{}, { title: '' }, { title: '   ' }, { title: null }, { title: 123 }, { title: ['Requested Book'] }])(
    'rejects invalid audiobook title %j',
    async (input) => {
      await expect(validate(plainToInstance(SubmitWarehouseAudiobookRequestDto, input))).resolves.not.toHaveLength(0);
    },
  );

  it('accepts and trims title and author', async () => {
    const dto = plainToInstance(SubmitWarehouseAudiobookRequestDto, {
      title: '  Requested Audiobook  ',
      author: '  Ada Narrator  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.title).toBe('Requested Audiobook');
    expect(dto.author).toBe('Ada Narrator');
  });

  it('trims blank author to undefined', async () => {
    const dto = plainToInstance(SubmitWarehouseAudiobookRequestDto, {
      title: 'Requested Audiobook',
      author: '   ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.author).toBeUndefined();
  });

  it('enforces title and author length limits', async () => {
    await expect(
      validate(plainToInstance(SubmitWarehouseAudiobookRequestDto, { title: 'a'.repeat(256), author: 'b'.repeat(160) })),
    ).resolves.toHaveLength(0);
    await expect(validate(plainToInstance(SubmitWarehouseAudiobookRequestDto, { title: 'a'.repeat(257) }))).resolves.not.toHaveLength(0);
    await expect(
      validate(plainToInstance(SubmitWarehouseAudiobookRequestDto, { title: 'Requested Audiobook', author: 'b'.repeat(161) })),
    ).resolves.not.toHaveLength(0);
  });
});
