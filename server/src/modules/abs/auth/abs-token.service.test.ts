import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AbsTokenService } from './abs-token.service';

function buildService(secret = 'test-secret-1234567890'): AbsTokenService {
  const config = { get: (key: string) => (key === 'auth.jwtSecret' ? secret : undefined) } as unknown as ConfigService;
  return new AbsTokenService(new JwtService({}), config);
}

describe('AbsTokenService', () => {
  it('mints and verifies an access token carrying the ABS payload', () => {
    const service = buildService();
    const token = service.signAccessToken(5, 'alice', 'sess-1');
    const payload = service.verifyAccessToken(token);
    expect(payload).toMatchObject({ userId: 5, username: 'alice', type: 'access', sid: 'sess-1' });
    expect(payload?.jti).toBeTruthy();
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('mints a refresh token with a ~30d expiry and rejects it as an access token', () => {
    const service = buildService();
    const { token, expiresAt } = service.signRefreshToken(5, 'alice');
    expect(service.verifyRefreshToken(token)).toMatchObject({ userId: 5, type: 'refresh' });
    expect(service.verifyAccessToken(token)).toBeNull(); // type mismatch
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects tokens signed with a different secret', () => {
    const minted = buildService('secret-a-1234567890').signAccessToken(1, 'bob', 'sess-1');
    expect(buildService('secret-b-1234567890').verifyAccessToken(minted)).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    const service = buildService();
    expect(service.verifyAccessToken('not.a.jwt')).toBeNull();
    expect(service.verifyRefreshToken('')).toBeNull();
  });

  // Without a sid the guard cannot check revocation, so such a token must not authenticate.
  it('rejects an access token that carries no session binding', () => {
    const service = buildService();
    const unbound = new JwtService({}).sign(
      { userId: 5, username: 'alice', type: 'access' },
      { secret: 'test-secret-1234567890', algorithm: 'HS256', expiresIn: 3600, jwtid: 'j1' },
    );
    expect(service.verifyAccessToken(unbound)).toBeNull();
  });
});
