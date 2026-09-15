import { z } from 'zod';
import { safeFetch, SafeFetchHttpError } from '../../sdk/safe-fetch.mjs';

export const X_TWEETS_URL = 'https://api.x.com/2/tweets';

export class XApiError extends Error {
  constructor(code, { httpStatus, retryAfterSeconds } = {}) {
    super(`X API: ${code}`); this.name = 'XApiError'; this.code = code; this.httpStatus = httpStatus; this.retryAfterSeconds = retryAfterSeconds;
  }
}

const postResponseSchema = z.object({ data: z.object({ id: z.string().regex(/^[0-9]{1,32}$/), text: z.string() }) }).passthrough();

function canonicalXProfile(value) {
  const url = new URL(value);
  if (url.origin !== 'https://x.com' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_]{1,15}$/.test(url.pathname))
    throw new Error('Invalid X profile URL');
  return url;
}

/** Publishes through the official API only -- no browser automation, no scraping. The
 * public permalink is built from the already-verified profile URL, not trusted API text. */
export function createXApi({ transport = safeFetch } = {}) {
  return {
    async createPost({ text, accessToken, profileUrl }, { signal } = {}) {
      signal?.throwIfAborted();
      if (typeof text !== 'string' || !text.trim() || [...text].length > 280) throw new Error('X post text must be 1-280 characters');
      if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 4096) throw new Error('Invalid X access token');
      const profile = canonicalXProfile(profileUrl);
      let response;
      try {
        response = await transport(X_TWEETS_URL, { method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }), maxBytes: 65536, timeoutMs: 10000 });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof SafeFetchHttpError) {
          const status = error.statusCode;
          if (status === 401) throw new XApiError('credentials-expired', { httpStatus: status });
          if (status === 429) throw new XApiError('rate-limited', { httpStatus: status, retryAfterSeconds: error.retryAfterSeconds });
          if (status === 403) throw new XApiError('site-unavailable', { httpStatus: status });
          throw new XApiError('request-rejected', { httpStatus: status });
        }
        throw new XApiError('transport-unavailable');
      }
      const parsed = postResponseSchema.parse(JSON.parse(response.bytes));
      return { id: parsed.data.id, url: `${profile.origin}${profile.pathname}/status/${parsed.data.id}` };
    },
  };
}
