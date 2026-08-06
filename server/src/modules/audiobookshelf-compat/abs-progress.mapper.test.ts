import { BadRequestException } from '@nestjs/common';

import { mapAbsProgressPayload, mapAbsSessionPayload, mapAbsSessionBatchPayload } from './abs-progress.mapper';

describe('ABS progress mapper', () => {
  it('normalizes common ABS progress payload aliases', () => {
    expect(
      mapAbsProgressPayload('bo_l_3_book_55', {
        progress: 0.625,
        currentTime: 123.4,
        duration: 200,
        sessionId: 'abs-session-1',
        updatedAt: '2026-06-01T12:30:00.000Z',
      }),
    ).toEqual({
      itemId: 'bo_l_3_book_55',
      progressPercent: 62.5,
      positionSeconds: 123.4,
      durationSeconds: 200,
      isFinished: false,
      sessionId: 'abs-session-1',
      startedAt: undefined,
      endedAt: '2026-06-01T12:30:00.000Z',
    });
  });

  it('accepts body item ids and marks finished payloads complete', () => {
    expect(
      mapAbsProgressPayload(undefined, {
        itemId: 'bo_bw_audio_catalog_77',
        percentage: 80,
        positionSeconds: 400,
        finished: true,
      }),
    ).toMatchObject({
      itemId: 'bo_bw_audio_catalog_77',
      progressPercent: 100,
      positionSeconds: 400,
      isFinished: true,
    });
  });

  it('rejects progress updates without an ABS item id', () => {
    expect(() => mapAbsProgressPayload(undefined, { progressPercent: 10 })).toThrow(BadRequestException);
  });
});

describe('ABS session mapper', () => {
  it('maps offline session payloads using route or body item ids', () => {
    expect(
      mapAbsSessionPayload({
        id: 'bo_l_3_book_55',
        sessionId: 'offline-1',
        startedAt: '2026-06-01T12:00:00.000Z',
        endedAt: '2026-06-01T12:30:00.000Z',
        time: 1800,
        progress: 0.35,
      }),
    ).toEqual({
      itemId: 'bo_l_3_book_55',
      sessionId: 'offline-1',
      startedAt: '2026-06-01T12:00:00.000Z',
      endedAt: '2026-06-01T12:30:00.000Z',
      durationSeconds: 1800,
      endProgress: 35,
      progressDelta: null,
      positionSeconds: 1800,
    });
  });

  it('treats mediaItemId as the item id when id is the ABS session id', () => {
    expect(
      mapAbsSessionPayload({
        id: 'session-row-1',
        mediaItemId: 'bo_bw_audio_catalog_77',
        startedAt: '2026-06-01T12:00:00.000Z',
        endedAt: '2026-06-01T12:30:00.000Z',
        durationSeconds: 1800,
        percentage: 50,
      }),
    ).toMatchObject({
      itemId: 'bo_bw_audio_catalog_77',
      sessionId: 'session-row-1',
      endProgress: 50,
    });
  });

  it('returns null when an ABS session lacks required timestamps instead of inventing one', () => {
    expect(
      mapAbsSessionPayload({
        itemId: 'bo_l_3_book_55',
        sessionId: 'offline-2',
        currentTime: 120,
        progressPercent: 10,
      }),
    ).toBeNull();
  });

  it('accepts local-all arrays and session wrapper shapes', () => {
    expect(
      mapAbsSessionBatchPayload({
        sessions: [
          {
            itemId: 'bo_l_3_book_55',
            sessionId: 'offline-1',
            startedAt: '2026-06-01T12:00:00.000Z',
            updatedAt: '2026-06-01T12:05:00.000Z',
            duration: 300,
            progressPercent: 15,
          },
        ],
      }),
    ).toHaveLength(1);
  });
});
