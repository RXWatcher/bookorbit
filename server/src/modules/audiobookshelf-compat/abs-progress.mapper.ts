import { BadRequestException } from '@nestjs/common';

export type AbsNormalizedProgressUpdate = {
  itemId: string;
  progressPercent: number;
  positionSeconds?: number;
  durationSeconds?: number;
  isFinished: boolean;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
};

export type AbsNormalizedSession = {
  itemId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  positionSeconds?: number;
};

type RawObject = Record<string, unknown>;

export function mapAbsProgressPayload(routeItemId: string | undefined, payload: unknown): AbsNormalizedProgressUpdate {
  const body = objectPayload(payload);
  const itemId = readItemId(routeItemId, body, ['itemId', 'id', 'mediaItemId', 'libraryItemId']);
  const isFinished = readBoolean(body, ['isFinished', 'finished']) ?? false;
  const explicitProgress = readNumber(body, ['progress', 'percentage', 'progressPercent']);
  const progressPercent = isFinished ? 100 : normalizePercent(explicitProgress, 'progress');

  return {
    itemId,
    progressPercent,
    positionSeconds: readNonnegativeNumber(body, ['currentTime', 'position', 'positionSeconds', 'time']),
    durationSeconds: readNonnegativeNumber(body, ['duration', 'durationSeconds']),
    isFinished,
    sessionId: readString(body, ['sessionId']),
    startedAt: readString(body, ['startedAt']),
    endedAt: readString(body, ['endedAt', 'updatedAt']),
  };
}

export function mapAbsSessionPayload(payload: unknown): AbsNormalizedSession | null {
  const body = objectPayload(payload);
  const itemId = readItemId(undefined, body, ['itemId', 'mediaItemId', 'libraryItemId', 'id']);
  const sessionId = readString(body, ['sessionId', 'id']);
  if (!sessionId || sessionId === itemId) {
    throw new BadRequestException('sessionId is required.');
  }

  const startedAt = readString(body, ['startedAt']);
  const endedAt = readString(body, ['endedAt', 'updatedAt']);
  const explicitDuration = readNonnegativeNumber(body, ['durationSeconds', 'duration', 'time']);

  if (!startedAt || !endedAt || explicitDuration === undefined) {
    return null;
  }

  return {
    itemId,
    sessionId,
    startedAt,
    endedAt,
    durationSeconds: Math.floor(explicitDuration),
    progressDelta: readNumber(body, ['progressDelta']) ?? null,
    endProgress: readOptionalPercent(body, ['endProgress', 'progress', 'percentage', 'progressPercent']),
    positionSeconds: readNonnegativeNumber(body, ['currentTime', 'position', 'positionSeconds', 'time']),
  };
}

export function mapAbsSessionBatchPayload(payload: unknown): AbsNormalizedSession[] {
  const rawSessions = Array.isArray(payload)
    ? payload
    : (objectPayload(payload).sessions ?? objectPayload(payload).localSessions ?? objectPayload(payload).items);
  if (!Array.isArray(rawSessions)) {
    throw new BadRequestException('sessions must be an array.');
  }

  return rawSessions.map((entry) => mapAbsSessionPayload(entry)).filter((entry): entry is AbsNormalizedSession => entry !== null);
}

function objectPayload(payload: unknown): RawObject {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new BadRequestException('ABS payload must be an object.');
  }
  return payload as RawObject;
}

function readItemId(routeItemId: string | undefined, body: RawObject, keys: string[]): string {
  const itemId = routeItemId ?? readString(body, keys);
  if (!itemId) {
    throw new BadRequestException('ABS item id is required.');
  }
  return itemId;
}

function readString(body: RawObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function readBoolean(body: RawObject, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

function readNumber(body: RawObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readNonnegativeNumber(body: RawObject, keys: string[]): number | undefined {
  const value = readNumber(body, keys);
  if (value === undefined) return undefined;
  if (value < 0) {
    throw new BadRequestException(`${keys[0]} must be nonnegative.`);
  }
  return value;
}

function readOptionalPercent(body: RawObject, keys: string[]): number | null {
  const value = readNumber(body, keys);
  if (value === undefined) return null;
  return normalizePercent(value, keys[0]);
}

function normalizePercent(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new BadRequestException(`${field} is required.`);
  }
  const percent = value <= 1 ? value * 100 : value;
  if (percent < 0 || percent > 100) {
    throw new BadRequestException(`${field} must be between 0 and 100.`);
  }
  return Math.round(percent * 100) / 100;
}
