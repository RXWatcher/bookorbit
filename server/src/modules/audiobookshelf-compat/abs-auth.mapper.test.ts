import { mapAbsAuthUser, mapAbsLoginResponse } from './abs-auth.mapper';

describe('abs-auth.mapper', () => {
  it('maps a BookOrbit user into the ABS user envelope without leaking password data', () => {
    const mapped = mapAbsAuthUser({
      id: 42,
      username: 'ramindexadmin',
      email: 'admin@example.test',
      isSuperuser: true,
    });

    expect(mapped).toEqual({
      id: '42',
      username: 'ramindexadmin',
      email: 'admin@example.test',
      type: 'root',
      token: null,
      mediaProgress: [],
      seriesHideFromContinueListening: [],
      bookmarks: [],
    });
    expect(mapped).not.toHaveProperty('passwordHash');
    expect(mapped).not.toHaveProperty('password');
  });

  it('maps the ABS login response envelope and normalizes an omitted refresh token to null', () => {
    const response = mapAbsLoginResponse(
      {
        id: 7,
        username: 'reader',
        email: null,
        isSuperuser: false,
      },
      'abs-token-123',
    );

    expect(response).toMatchObject({
      user: {
        id: '7',
        username: 'reader',
        email: null,
        type: 'user',
        token: null,
        mediaProgress: [],
        seriesHideFromContinueListening: [],
        bookmarks: [],
      },
      token: 'abs-token-123',
      refreshToken: null,
      source: 'bookorbit',
      serverSettings: {
        authMethods: ['local'],
      },
    });
  });
});
