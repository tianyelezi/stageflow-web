import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyInternalHmac } from '@/lib/internal-hmac';

function sign(secret: string, ts: string, body: string): string {
  return createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

describe('verifyInternalHmac', () => {
  const secret = 'super-secret';
  const body = JSON.stringify({ projectId: 'p1', event: 'proposal_ready' });
  const now = 1_700_000_000;
  const ts = String(now);

  it('accepts a correctly signed recent request', () => {
    const signature = sign(secret, ts, body);
    const verdict = verifyInternalHmac({
      secret,
      body,
      headers: { timestamp: ts, signature },
      now,
    });
    expect(verdict.ok).toBe(true);
  });

  it('rejects a request with stale timestamp', () => {
    const signature = sign(secret, ts, body);
    const verdict = verifyInternalHmac({
      secret,
      body,
      headers: { timestamp: ts, signature },
      now: now + 600, // 10 min later
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('stale timestamp');
  });

  it('rejects a request with tampered body', () => {
    const signature = sign(secret, ts, body);
    const verdict = verifyInternalHmac({
      secret,
      body: body + 'x',
      headers: { timestamp: ts, signature },
      now,
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects a request with wrong secret', () => {
    const signature = sign('other', ts, body);
    const verdict = verifyInternalHmac({
      secret,
      body,
      headers: { timestamp: ts, signature },
      now,
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects a request with missing headers', () => {
    const verdict = verifyInternalHmac({
      secret,
      body,
      headers: { timestamp: null, signature: null },
      now,
    });
    expect(verdict.ok).toBe(false);
  });
});
