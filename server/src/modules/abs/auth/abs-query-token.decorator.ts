import { SetMetadata } from '@nestjs/common';

export const ABS_ALLOW_QUERY_TOKEN = 'abs:allowQueryToken';

/**
 * Opt a route into `?token=<jwt>` authentication.
 *
 * ABS clients genuinely need query-param auth for media the browser fetches without headers:
 * `<audio src>` and download links cannot carry an `Authorization` header. Everything else is an
 * XHR that can, so by default {@link AbsAuthGuard} accepts the bearer header only.
 *
 * This matters because an access token in a URL leaks into proxy and access logs, browser history
 * and `Referer` headers. Upstream accepts `?token=` on every protected route; here it is confined
 * to the handful that cannot work without it.
 */
export const AbsAllowQueryToken = () => SetMetadata(ABS_ALLOW_QUERY_TOKEN, true);
