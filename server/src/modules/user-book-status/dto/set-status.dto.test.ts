import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SetStatusDto } from './set-status.dto';

async function errorsFor(value: Record<string, unknown>) {
  return validate(plainToInstance(SetStatusDto, value));
}

describe('SetStatusDto', () => {
  it('accepts status-only payload', async () => {
    expect((await errorsFor({ status: 'reading' })).length).toBe(0);
  });

  it('accepts date-only or datetime values and explicit null clearing', async () => {
    expect((await errorsFor({ status: null })).length).toBe(0);
    expect((await errorsFor({ startedAt: '2026-05-20', finishedAt: '2026-05-21' })).length).toBe(0);
    expect((await errorsFor({ startedAt: '2026-05-20T12:30:00.000Z' })).length).toBe(0);
    expect((await errorsFor({ startedAt: null, finishedAt: null })).length).toBe(0);
  });

  it('rejects malformed date strings and unknown statuses', async () => {
    expect((await errorsFor({ startedAt: '20-05-2026' })).length).toBeGreaterThan(0);
    expect((await errorsFor({ finishedAt: 'not-a-date' })).length).toBeGreaterThan(0);
    expect((await errorsFor({ status: 'done' })).length).toBeGreaterThan(0);
  });
});
