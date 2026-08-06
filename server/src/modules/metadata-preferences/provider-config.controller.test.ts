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
      getProviderStatuses: vi.fn(),
      updateConfig: vi.fn(),
      testProvider: vi.fn(),
    } as unknown as Mocked<ProviderConfigService>;

    controller = new ProviderConfigController(service);
  });

  it('returns both provider config and computed statuses', async () => {
    const config = {
      google: { enabled: true, apiKey: 'key' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: true },
      hardcover: { enabled: false, apiKey: '' },
      openLibrary: { enabled: true },
    };
    const statuses = [{ key: 'google', enabled: true, configured: true, label: 'Google Books' }];

    service.getConfig.mockResolvedValue(config as never);
    service.getProviderStatuses.mockResolvedValue(statuses as never);

    const result = await controller.getConfig();

    expect(service.getConfig).toHaveBeenCalledTimes(1);
    expect(service.getProviderStatuses).toHaveBeenCalledWith(config);
    expect(result).toEqual({ config, statuses });
  });

  it('delegates config updates', async () => {
    const patch = {
      google: { enabled: false },
      amazon: { cookie: 'session' },
    };
    service.updateConfig.mockResolvedValue({} as never);

    await controller.updateConfig(patch as never);

    expect(service.updateConfig).toHaveBeenCalledWith(patch);
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
