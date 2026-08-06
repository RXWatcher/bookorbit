import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class UserPreferencesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findByCategory(userId: number, category: string) {
    return this.db.query.userPreferences.findFirst({
      where: and(eq(schema.userPreferences.userId, userId), eq(schema.userPreferences.category, category)),
    });
  }

  async upsert(userId: number, category: string, data: Record<string, unknown>) {
    const now = new Date();
    await this.db
      .insert(schema.userPreferences)
      .values({ userId, category, data, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.userPreferences.userId, schema.userPreferences.category],
        set: { data, updatedAt: now },
      });
  }

  async delete(userId: number, category: string) {
    await this.db.delete(schema.userPreferences).where(and(eq(schema.userPreferences.userId, userId), eq(schema.userPreferences.category, category)));
  }
}
