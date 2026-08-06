import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BrowseEntitiesDto } from './entity-manager.dto';

describe('BrowseEntitiesDto', () => {
  it('accepts empty book count filtering', async () => {
    const dto = plainToInstance(BrowseEntitiesDto, { bookCount: 'empty' });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid book count filtering', async () => {
    const dto = plainToInstance(BrowseEntitiesDto, { bookCount: 'zero' });

    const errors = await validate(dto);

    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'bookCount' })]));
  });
});
