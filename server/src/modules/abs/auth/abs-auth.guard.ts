import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { UserService } from '../../user/user.service';
import { ABS_ALLOW_QUERY_TOKEN } from './abs-query-token.decorator';
import { AbsSessionService } from './abs-session.service';
import { AbsTokenService } from './abs-token.service';

/**
 * Authenticates ABS API requests. The JWT normally arrives as `Authorization: Bearer <jwt>`; routes
 * decorated with `@AbsAllowQueryToken()` additionally accept `?token=<jwt>`, which is how
 * `<audio src>` and download links authenticate (REIMPLEMENTATION_GUIDE §2.1).
 *
 * Beyond signature and expiry the guard resolves the token's `sid` against `abs_sessions`, so
 * logging out revokes the access token immediately instead of leaving it live for up to its
 * remaining hour. See {@link AbsSessionService.findActiveSession}.
 *
 * Populates `request.user` with the standard RequestUser so handlers can use `@CurrentUser()`.
 * ABS controllers are marked `@Public()` to bypass BookOrbit's native global guards, so this guard
 * is applied explicitly via `@UseGuards(AbsAuthGuard)`.
 */
@Injectable()
export class AbsAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: AbsTokenService,
    private readonly userService: UserService,
    private readonly sessionService: AbsSessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: unknown }>();
    const allowQueryToken = this.reflector.getAllAndOverride<boolean>(ABS_ALLOW_QUERY_TOKEN, [context.getHandler(), context.getClass()]) ?? false;

    const token = extractAbsToken(request, allowQueryToken);
    if (!token) throw new UnauthorizedException();

    const payload = this.tokenService.verifyAccessToken(token);
    if (!payload) throw new UnauthorizedException();

    // Revocation check: the session must still exist and be unexpired. A logout deletes the row.
    const session = await this.sessionService.findActiveSession(payload.sid);
    if (!session || session.userId !== payload.userId) throw new UnauthorizedException();

    const user = await this.userService.findByIdWithPermissions(payload.userId);
    if (!user || !user.active) throw new UnauthorizedException();

    request.user = user;
    return true;
  }
}

/**
 * Pull the ABS JWT from the Authorization header, falling back to `?token=` only when the caller
 * permits it. Defaults to permitting the query param because the non-guard callers
 * (`/api/authorize`, `/api/me`) use this to echo back whatever token the client presented.
 */
export function extractAbsToken(request: FastifyRequest, allowQueryToken = true): string | null {
  const header = request.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  if (!allowQueryToken) return null;
  const queryToken = (request.query as Record<string, unknown> | undefined)?.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }
  return null;
}
