import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const HEX_256_BIT_KEY = /^[a-fA-F0-9]{64}$/;

export interface EncryptedWarehouseSecret {
  ciphertext: string;
  nonce: string;
  tag: string;
}

@Injectable()
export class WarehouseSecretService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): EncryptedWarehouseSecret {
    const key = this.key();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  decrypt(secret: EncryptedWarehouseSecret): string {
    const key = this.key();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));

    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  mask(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length < 10) return '***';
    return `${value.slice(0, 3)}...${value.slice(-3)}`;
  }

  private key(): Buffer {
    const raw = this.config.get<string>('app.warehouse.encryptionKey')?.trim();
    if (!raw) {
      throw new BadRequestException('WAREHOUSE_ENCRYPTION_KEY is required before saving a catalog source API key');
    }

    if (!HEX_256_BIT_KEY.test(raw)) {
      throw new BadRequestException('WAREHOUSE_ENCRYPTION_KEY must be a 64-character hex key before saving a catalog source API key');
    }

    return Buffer.from(raw, 'hex');
  }
}
