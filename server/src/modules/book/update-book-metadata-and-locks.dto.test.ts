import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateBookMetadataAndLocksDto } from './dto/update-book-metadata-and-locks.dto';

describe('UpdateBookMetadataAndLocksDto', () => {
  it('accepts metadata updates with a final lock set', async () => {
    const dto = plainToInstance(UpdateBookMetadataAndLocksDto, {
      metadata: { goodreadsId: 'manual-id' },
      lockedFields: ['goodreadsId'],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts lock-only updates with empty metadata', async () => {
    const dto = plainToInstance(UpdateBookMetadataAndLocksDto, {
      metadata: {},
      lockedFields: ['title'],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid metadata fields and invalid lock fields', async () => {
    const dto = plainToInstance(UpdateBookMetadataAndLocksDto, {
      metadata: { publishedYear: 42 },
      lockedFields: ['not-a-field'],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
