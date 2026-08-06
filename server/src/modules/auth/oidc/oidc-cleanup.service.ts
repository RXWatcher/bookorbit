import { Inject, Injectable } from '@nestjs/common';
import { lt, or, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface OidcCleanupResult {
  deletedSessions: number;
  deletedStates: number;
  deletedJtis: number;
}

@Injectable()
export class OidcCleanupService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async runCleanup(): Promise<OidcCleanupResult> {
    const now = new Date();

    const [sessions, states, jtis] = await Promise.all([
      this.db
        .delete(schema.oidcSessions)
        .where(or(lt(schema.oidcSessions.expiresAt, now), eq(schema.oidcSessions.revoked, true)))
        .returning({ id: schema.oidcSessions.id }),
      this.db.delete(schema.oidcStates).where(lt(schema.oidcStates.expiresAt, now)).returning({ state: schema.oidcStates.state }),
      this.db.delete(schema.oidcUsedJtis).where(lt(schema.oidcUsedJtis.expiresAt, now)).returning({ jti: schema.oidcUsedJtis.jti }),
    ]);

    return {
      deletedSessions: sessions.length,
      deletedStates: states.length,
      deletedJtis: jtis.length,
    };
  }
}
