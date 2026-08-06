import 'reflect-metadata';

vi.mock('../../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../../warehouse/warehouse.module', () => ({ WarehouseModule: class WarehouseModule {} }));

import { BookModule } from '../../book/book.module';
import { WarehouseModule } from '../../warehouse/warehouse.module';
import { CbzController } from './cbz.controller';
import { CbzModule } from './cbz.module';
import { CbzService } from './cbz.service';

describe('CbzModule', () => {
  it('registers expected imports/controllers/providers', () => {
    expect(Reflect.getMetadata('imports', CbzModule)).toEqual([BookModule, WarehouseModule]);
    expect(Reflect.getMetadata('controllers', CbzModule)).toEqual([CbzController]);
    expect(Reflect.getMetadata('providers', CbzModule)).toEqual([CbzService]);
  });
});
