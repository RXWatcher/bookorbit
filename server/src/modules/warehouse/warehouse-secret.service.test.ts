import { BadRequestException } from '@nestjs/common';

import { WarehouseSecretService } from './warehouse-secret.service';

const VALID_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makeConfig(key: string | undefined) {
  return {
    get: (path: string) => {
      if (path === 'warehouse.encryptionKey') {
        throw new Error('WarehouseSecretService must use the namespaced app config path');
      }
      return path === 'app.warehouse.encryptionKey' ? key : undefined;
    },
  };
}

describe('WarehouseSecretService', () => {
  it('encrypts and decrypts API keys without storing plaintext', () => {
    const service = new WarehouseSecretService(makeConfig(VALID_HEX_KEY) as never);

    const encrypted = service.encrypt('warehouse-key-123');

    expect(encrypted.ciphertext).not.toContain('warehouse-key-123');
    expect(service.decrypt(encrypted)).toBe('warehouse-key-123');
  });

  it('throws when encrypting without a configured encryption key', () => {
    const service = new WarehouseSecretService(makeConfig('') as never);

    expect(() => service.encrypt('secret')).toThrow(BadRequestException);
    expect(() => service.encrypt('secret')).toThrow('WAREHOUSE_ENCRYPTION_KEY is required before saving a catalog source API key');
  });

  it('throws when encrypting with an invalid encryption key format', () => {
    const service = new WarehouseSecretService(makeConfig('not-a-64-character-hex-key') as never);

    expect(() => service.encrypt('secret')).toThrow(BadRequestException);
    expect(() => service.encrypt('secret')).toThrow('WAREHOUSE_ENCRYPTION_KEY must be a 64-character hex key before saving a catalog source API key');
  });

  it('masks API keys for admin display', () => {
    const service = new WarehouseSecretService(makeConfig(VALID_HEX_KEY) as never);

    expect(service.mask('abc123456789xyz')).toBe('abc...xyz');
    expect(service.mask('short')).toBe('***');
    expect(service.mask(null)).toBeNull();
  });
});
