export interface AbsStatusResponse {
  server: 'BookOrbit';
  version: string;
  language: 'en-us';
  authMethods: Array<'local' | 'oidc' | 'app-token'>;
}

export interface AbsPingResponse {
  success: true;
}
