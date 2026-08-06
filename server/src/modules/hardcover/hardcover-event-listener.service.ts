import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  AchievementEventsService,
  type BookProgressChangedPayload,
  type BookRatingChangedPayload,
  type BookStatusChangedPayload,
  type ReadingSessionSavedPayload,
} from '../achievement/achievement-events.service';
import { HardcoverAutoSyncSchedulerService } from './hardcover-auto-sync-scheduler.service';

@Injectable()
export class HardcoverEventListener implements OnModuleInit {
  constructor(
    private readonly achievementEvents: AchievementEventsService,
    private readonly scheduler: HardcoverAutoSyncSchedulerService,
  ) {}

  onModuleInit() {
    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, (payload: BookStatusChangedPayload) => {
      void this.handleStatusChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_READING_SESSION_SAVED, (payload: ReadingSessionSavedPayload) => {
      this.handleReadingSessionSaved(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, (payload: BookProgressChangedPayload) => {
      this.handleProgressChanged(payload);
    });

    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, (payload: BookRatingChangedPayload) => {
      this.handleRatingChanged(payload);
    });
  }

  private handleStatusChanged(payload: BookStatusChangedPayload): void {
    this.scheduler.requestSync({ userId: payload.userId, bookId: payload.bookId, reason: 'status' });
  }

  private handleReadingSessionSaved(payload: ReadingSessionSavedPayload): void {
    this.scheduler.requestSyncForBookFile({ userId: payload.userId, bookFileId: payload.bookFileId, reason: 'progress' });
  }

  private handleProgressChanged(payload: BookProgressChangedPayload): void {
    this.scheduler.requestSync({ userId: payload.userId, bookId: payload.bookId, reason: 'progress' });
  }

  private handleRatingChanged(payload: BookRatingChangedPayload): void {
    for (const bookId of payload.bookIds) {
      this.scheduler.requestSync({ userId: payload.userId, bookId, reason: 'rating' });
    }
  }
}
