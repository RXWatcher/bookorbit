import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

/**
 * ABS access tokens live ~1h and refresh tokens ~30d (REIMPLEMENTATION_GUIDE §2.1). These are
 * fixed by the wire contract and intentionally independent of BookOrbit's own JWT lifetimes.
 */
export const ABS_ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60; // 1h
export const ABS_REFRESH_TOKEN_EXPIRY_SECONDS = 60 * 60 * 24 * 30; // 30d

export type AbsTokenType = 'access' | 'refresh';

export interface AbsTokenPayload {
  userId: number;
  username: string;
  jti: string;
  type: AbsTokenType;
  /** `abs_sessions.id` this token belongs to. Present on access tokens; the guard resolves it so
   *  a deleted session (logout) revokes the access token immediately. */
  sid: string;
  iat?: number;
  exp?: number;
}

/**
 * Mints and verifies the `{ userId, username, jti, type, exp }` HS256 JWTs that ABS clients carry.
 * Signed with BookOrbit's `JWT_SECRET` so a single secret governs the deployment.
 */
@Injectable()
export class AbsTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('auth.jwtSecret') ?? 'change-me-in-production';
  }

  /** `sessionId` is the `abs_sessions` row the token is bound to; the guard requires it to resolve. */
  signAccessToken(userId: number, username: string, sessionId: string): string {
    return this.sign(userId, username, 'access', ABS_ACCESS_TOKEN_EXPIRY_SECONDS, sessionId);
  }

  /** Returns the refresh JWT and the absolute expiry used to stamp the session row. */
  signRefreshToken(userId: number, username: string): { token: string; expiresAt: Date } {
    const token = this.sign(userId, username, 'refresh', ABS_REFRESH_TOKEN_EXPIRY_SECONDS);
    const expiresAt = new Date(Date.now() + ABS_REFRESH_TOKEN_EXPIRY_SECONDS * 1000);
    return { token, expiresAt };
  }

  /**
   * Verify signature + expiry; returns null on any failure so callers map to the right status.
   * A missing `sid` is rejected: without it the guard cannot check revocation, so an access token
   * minted before session binding must not authenticate.
   */
  verifyAccessToken(token: string): AbsTokenPayload | null {
    const payload = this.verify(token);
    if (!payload || payload.type !== 'access') return null;
    return typeof payload.sid === 'string' && payload.sid.length > 0 ? payload : null;
  }

  verifyRefreshToken(token: string): AbsTokenPayload | null {
    const payload = this.verify(token);
    return payload && payload.type === 'refresh' ? payload : null;
  }

  private sign(userId: number, username: string, type: AbsTokenType, expiresInSeconds: number, sessionId?: string): string {
    return this.jwtService.sign(
      { userId, username, type, ...(sessionId ? { sid: sessionId } : {}) },
      { secret: this.secret, algorithm: 'HS256', expiresIn: expiresInSeconds, jwtid: randomUUID() },
    );
  }

  private verify(token: string): AbsTokenPayload | null {
    try {
      return this.jwtService.verify<AbsTokenPayload>(token, { secret: this.secret, algorithms: ['HS256'] });
    } catch {
      return null;
    }
  }
}
