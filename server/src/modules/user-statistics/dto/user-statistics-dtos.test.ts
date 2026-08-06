import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

import { UpdateUserSessionTimelineSessionDto } from './update-user-session-timeline-session.dto';
import { UserDailyReadingQueryDto } from './user-daily-reading-query.dto';
import { UserGoalTrajectoryQueryDto } from './user-goal-trajectory-query.dto';
import { UserSessionTimelineQueryDto } from './user-session-timeline-query.dto';
import { UserStatisticsFilterQueryDto } from './user-statistics-filter-query.dto';

describe('User statistics DTOs', () => {
  it('transforms and validates library id filters', async () => {
    const dto = plainToInstance(UserStatisticsFilterQueryDto, { libraryIds: '7' });

    expect(dto.libraryIds).toEqual([7]);
    expect(await validate(dto)).toEqual([]);
  });

  it('transforms source-backed library aliases for user statistics filters', async () => {
    const dto = plainToInstance(UserStatisticsFilterQueryDto, { libraryIds: ['ebooks', 'audiobooks', 'comics'] });

    expect(dto.libraryIds).toEqual([CLOUD_EBOOK_LIBRARY_ID, CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID]);
    expect(await validate(dto)).toEqual([]);
  });

  it('transforms comparePrevious flag and validates day bounds', async () => {
    const valid = plainToInstance(UserDailyReadingQueryDto, {
      libraryIds: ['1', '3'],
      comparePrevious: 'yes',
      days: '30',
    });
    const invalid = plainToInstance(UserDailyReadingQueryDto, {
      comparePrevious: 'true',
      days: 0,
    });

    expect(valid.libraryIds).toEqual([1, 3]);
    expect(valid.comparePrevious).toBe(true);
    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).length).toBeGreaterThan(0);

    const sourceBacked = plainToInstance(UserDailyReadingQueryDto, {
      libraryIds: ['ebooks', 'audiobooks', 'comics'],
      days: '30',
    });
    expect(sourceBacked.libraryIds).toEqual([CLOUD_EBOOK_LIBRARY_ID, CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID]);
    expect(await validate(sourceBacked)).toEqual([]);
  });

  it('enforces goal trajectory and session timeline bounds', async () => {
    const goal = plainToInstance(UserGoalTrajectoryQueryDto, {
      days: 365,
      goalBooks: 24,
    });
    const badGoal = plainToInstance(UserGoalTrajectoryQueryDto, { goalBooks: 0 });

    const timeline = plainToInstance(UserSessionTimelineQueryDto, {
      year: 2026,
      week: 12,
      libraryIds: '9',
    });
    const badTimeline = plainToInstance(UserSessionTimelineQueryDto, {
      year: 1800,
      week: 99,
    });

    expect(await validate(goal)).toEqual([]);
    expect((await validate(badGoal)).length).toBeGreaterThan(0);
    expect(timeline.libraryIds).toEqual([9]);
    expect(await validate(timeline)).toEqual([]);
    expect((await validate(badTimeline)).length).toBeGreaterThan(0);
  });

  it('requires ISO timestamps when updating timeline sessions', async () => {
    const valid = plainToInstance(UpdateUserSessionTimelineSessionDto, {
      startedAt: '2026-04-12T10:00:00.000Z',
      endedAt: '2026-04-12T10:30:00.000Z',
    });
    const invalid = plainToInstance(UpdateUserSessionTimelineSessionDto, {
      startedAt: 'not-a-date',
      endedAt: 'still-not-a-date',
    });

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});
