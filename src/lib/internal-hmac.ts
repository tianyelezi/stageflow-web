/**
 * HMAC-signed payload verification for server-to-server calls from the
 * Python workflow into the BFF. Keeps the shared secret out of URL/query.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacHeaders {
  timestamp: string | null;
  signature: string | null;
}

const MAX_SKEW_SECONDS = 300; // 5 min

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyInternalHmac(params: {
  secret: string;
  headers: HmacHeaders;
  body: string;
  now?: number; // seconds since epoch; injectable for tests
}): { ok: true } | { ok: false; reason: string } {
  const { secret, headers, body } = params;
  const now = params.now ?? Math.floor(Date.now() / 1000);

  if (!headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing headers' };
  }

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale timestamp' };
  }

  const expected = sign(secret, headers.timestamp, body);
  const got = headers.signature;

  // timingSafeEqual requires equal-length buffers.
  if (expected.length !== got.length) {
    return { ok: false, reason: 'signature length mismatch' };
  }

  const expectedBuf = Buffer.from(expected, 'utf8');
  const gotBuf = Buffer.from(got, 'utf8');
  if (!timingSafeEqual(expectedBuf, gotBuf)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}
