import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { UserService } from '../../user/user.service';
import { makeAbsUser, makeRequest } from '../__testing__/abs-test-helpers';
import { AbsAuthGuard, extractAbsToken } from './abs-auth.guard';
import type { AbsSessionService } from './abs-session.service';
import type { AbsTokenService } from './abs-token.service';

function makeContext(request: unknown) {
  return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} } as any;
}

describe('extractAbsToken', () => {
  it('reads a Bearer token from the Authorization header', () => {
    expect(extractAbsToken(makeRequest({ headers: { authorization: 'Bearer abc.def' } }))).toBe('abc.def');
  });

  it('reads the ?token= query param when the caller permits it', () => {
    expect(extractAbsToken(makeRequest({ query: { token: 'qtok' } }), true)).toBe('qtok');
  });

  it('ignores ?token= when the caller does not permit it', () => {
    expect(extractAbsToken(makeRequest({ query: { token: 'qtok' } }), false)).toBeNull();
  });

  it('returns null when no token is present or the bearer is empty', () => {
    expect(extractAbsToken(makeRequest())).toBeNull();
    expect(extractAbsToken(makeRequest({ headers: { authorization: 'Bearer ' } }))).toBeNull();
  });
});

describe('AbsAuthGuard', () => {
  function build(opts: {
    payload?: { userId: number; username: string; sid?: string } | null;
    user?: unknown;
    session?: { id: string; userId: number } | null;
    allowQueryToken?: boolean;
  }) {
    const tokenService = { verifyAccessToken: vi.fn().mockReturnValue(opts.payload ?? null) } as unknown as AbsTokenService;
    const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue(opts.user ?? null) } as unknown as UserService;
    const sessionService = {
      findActiveSession: vi.fn().mockResolvedValue(opts.session === undefined ? { id: 'sess-1', userId: opts.payload?.userId ?? 1 } : opts.session),
    } as unknown as AbsSessionService;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(opts.allowQueryToken ?? false) } as unknown as Reflector;
    return { guard: new AbsAuthGuard(tokenService, userService, sessionService, reflector), sessionService, userService };
  }

  it('rejects a request with no token', async () => {
    const { guard } = build({});
    await expect(guard.canActivate(makeContext(makeRequest()))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid/expired token', async () => {
    const { guard } = build({ payload: null });
    const ctx = makeContext(makeRequest({ headers: { authorization: 'Bearer bad' } }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the user is missing or inactive', async () => {
    const { guard } = build({ payload: { userId: 1, username: 'a', sid: 'sess-1' }, user: makeAbsUser({ active: false }) });
    const ctx = makeContext(makeRequest({ headers: { authorization: 'Bearer ok' } }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches request.user and allows a valid token', async () => {
    const user = makeAbsUser({ id: 42 });
    const { guard } = build({ payload: { userId: 42, username: 'admin', sid: 'sess-1' }, user });
    const request = makeRequest({ headers: { authorization: 'Bearer ok' } });
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  // Revocation: a still-unexpired access token stops working the moment its session is gone.
  it('rejects a signature-valid token whose session has been logged out', async () => {
    const { guard, userService } = build({ payload: { userId: 42, username: 'admin', sid: 'sess-1' }, user: makeAbsUser({ id: 42 }), session: null });
    const ctx = makeContext(makeRequest({ headers: { authorization: 'Bearer still-valid' } }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userService.findByIdWithPermissions).not.toHaveBeenCalled();
  });

  // A token re-signed onto someone else's session must not borrow that session's validity.
  it('rejects when the session belongs to a different user', async () => {
    const { guard } = build({
      payload: { userId: 42, username: 'admin', sid: 'sess-1' },
      user: makeAbsUser({ id: 42 }),
      session: { id: 'sess-1', userId: 99 },
    });
    const ctx = makeContext(makeRequest({ headers: { authorization: 'Bearer ok' } }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a ?token= query param on a route that has not opted in', async () => {
    const { guard } = build({ payload: { userId: 42, username: 'admin', sid: 'sess-1' }, user: makeAbsUser({ id: 42 }), allowQueryToken: false });
    const ctx = makeContext(makeRequest({ query: { token: 'leaky' } }));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a ?token= query param on a media route that opted in', async () => {
    const user = makeAbsUser({ id: 42 });
    const { guard } = build({ payload: { userId: 42, username: 'admin', sid: 'sess-1' }, user, allowQueryToken: true });
    const request = makeRequest({ query: { token: 'ok' } });
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toBe(user);
  });
});
