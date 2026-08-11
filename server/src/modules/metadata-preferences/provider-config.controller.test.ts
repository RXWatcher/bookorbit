import { BadRequestException } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';
import { ProviderConfigController } from './provider-config.controller';
import type { Mocked } from 'vitest';
import { ProviderConfigService } from './provider-config.service';

describe('ProviderConfigController', () => {
  let service: Mocked<ProviderConfigService>;
  let controller: ProviderConfigController;

  beforeEach(() => {
    service = {
      getConfig: vi.fn(),
      getRedactedConfig: vi.fn(),
      getProviderStatuses: vi.fn(),
      updateConfig: vi.fn(),
      testProvider: vi.fn(),
    } as unknown as Mocked<ProviderConfigService>;

    controller = new ProviderConfigController(service);
  });

  it('returns both provider config and computed statuses', async () => {
    const config = {
      google: { enabled: true, apiKey: 'AIzaSyDistinctiveSecret' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: true },
      hardcover: { enabled: false, apiKey: '' },
      openLibrary: { enabled: true },
    };
    const statuses = [{ key: 'google', enabled: true, configured: true, label: 'Google Books' }];

    const redacted = { ...config, google: { enabled: true, apiKey: '__redacted__' } };

    service.getConfig.mockResolvedValue(config as never);
    service.getRedactedConfig.mockResolvedValue(redacted as never);
    service.getProviderStatuses.mockResolvedValue(statuses as never);

    const result = await controller.getConfig();

    // Statuses are computed from the real config, but the response must carry the redacted
    // one. Returning real keys here is what exposed a live Google Books key and a Hardcover
    // token to anyone who could reach this endpoint.
    expect(service.getProviderStatuses).toHaveBeenCalledWith(config);
    expect(result).toEqual({ config: redacted, statuses });
    expect(JSON.stringify(result)).not.toContain('AIzaSyDistinctiveSecret');
  });

  it('delegates config updates', async () => {
    const patch = {
      google: { enabled: false },
      amazon: { cookie: 'session' },
    };
    service.updateConfig.mockResolvedValue({} as never);
    service.getRedactedConfig.mockResolvedValue({ google: { enabled: false, apiKey: '' } } as never);

    const result = await controller.updateConfig(patch as never);

    expect(service.updateConfig).toHaveBeenCalledWith(patch);
    expect(JSON.stringify(result)).not.toContain('AIza');
  });

  it('delegates provider test requests', async () => {
    const patch = {
      hardcover: { apiKey: 'Bearer token' },
    };
    const result = { key: MetadataProviderKey.HARDCOVER, ok: true, status: 'success', message: 'Connected as reader.' };
    service.testProvider.mockResolvedValue(result as never);

    await expect(controller.testProvider('hardcover', patch as never)).resolves.toEqual(result);
    expect(service.testProvider).toHaveBeenCalledWith(MetadataProviderKey.HARDCOVER, patch);
  });

  it('rejects unknown provider keys for test requests', () => {
    expect(() => controller.testProvider('unknown-provider', {} as never)).toThrow(BadRequestException);
    expect(service.testProvider).not.toHaveBeenCalled();
  });
});
