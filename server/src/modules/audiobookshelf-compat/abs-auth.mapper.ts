export interface AbsAuthUserInput {
  id: number | string;
  username: string;
  email: string | null | undefined;
  isSuperuser?: boolean;
}

export interface AbsAuthUser {
  id: string;
  username: string;
  email: string | null;
  type: 'root' | 'user';
  token: null;
  mediaProgress: [];
  seriesHideFromContinueListening: [];
  bookmarks: [];
}

export interface AbsLoginResponse {
  user: AbsAuthUser;
  token: string;
  refreshToken: string | null;
  source: 'bookorbit';
  serverSettings: {
    version: string;
    authMethods: ['local'];
  };
}

export function mapAbsAuthUser(user: AbsAuthUserInput): AbsAuthUser {
  return {
    id: String(user.id),
    username: user.username,
    email: user.email ?? null,
    type: user.isSuperuser ? 'root' : 'user',
    token: null,
    mediaProgress: [],
    seriesHideFromContinueListening: [],
    bookmarks: [],
  };
}

export function mapAbsLoginResponse(user: AbsAuthUserInput, token: string, refreshToken?: string): AbsLoginResponse {
  return {
    user: mapAbsAuthUser(user),
    token,
    refreshToken: refreshToken ?? null,
    source: 'bookorbit',
    serverSettings: {
      version: process.env.npm_package_version ?? '0.0.0',
      authMethods: ['local'],
    },
  };
}
