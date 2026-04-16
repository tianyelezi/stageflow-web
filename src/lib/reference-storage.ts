/**
 * Reference-image storage.
 *
 * Files are written under ``REFERENCE_UPLOAD_DIR`` (default ``var/uploads/
 * references`` — intentionally outside ``public/`` so Next's static server
 * does NOT expose them). Access always goes through the BFF handler at
 * ``/api/projects/:id/references/:imgId`` which either:
 *   - verifies a short-lived HMAC signature (used by the Python workflow
 *     service when calling vision models), OR
 *   - checks the auth cookie + project membership (used by browsers).
 *
 * TODO(future): move to real object storage with presigned URLs; the
 * abstraction below (storageKey + signed URL) is designed so only
 * ``storeReferenceImage`` / ``readReferenceImage`` need swapping.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

import { env } from '@/lib/env';

const DEFAULT_UPLOAD_DIR = resolve(process.cwd(), 'var', 'uploads', 'references');
const DEFAULT_SIGN_TTL_SECONDS = 600; // 10 minutes — enough for a vision call

function uploadDir(): string {
  return process.env.REFERENCE_UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR;
}

function extensionFor(contentType: string, filename: string): string {
  const fromName = extname(filename).toLowerCase();
  if (fromName) return fromName;
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.bin';
}

export interface StoredReference {
  storageKey: string;
  url: string; // HMAC-signed BFF URL usable by both the Python service and browsers.
}

export async function storeReferenceImage(params: {
  projectId: string;
  imgId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}): Promise<StoredReference> {
  const { projectId, imgId, filename, contentType, buffer } = params;
  const ext = extensionFor(contentType, filename);
  const relKey = `${projectId}/${imgId}${ext}`;

  const dir = join(uploadDir(), projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(uploadDir(), relKey), buffer);

  return {
    storageKey: relKey,
    url: referenceUrlFor(projectId, imgId),
  };
}

/**
 * Build a short-lived HMAC-signed URL the Python workflow (or any server-
 * side caller) can fetch without a user cookie. Browsers can also hit the
 * same URL once authenticated; the BFF handler accepts either sig or
 * cookie.
 */
export function referenceUrlFor(
  projectId: string,
  imgId: string,
  ttlSeconds: number = DEFAULT_SIGN_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = computeSignature(projectId, imgId, exp);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
  const path = `/api/projects/${projectId}/references/${imgId}?sig=${sig}&exp=${exp}`;
  return base ? `${base}${path}` : path;
}

/**
 * Verify a signature previously issued by ``referenceUrlFor``. Returns
 * true only when the HMAC matches and the expiry has not passed.
 */
export function verifyReferenceSignature(
  projectId: string,
  imgId: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  const expected = computeSignature(projectId, imgId, exp);
  return timingSafeEqualHex(expected, sig);
}

function computeSignature(projectId: string, imgId: string, exp: number): string {
  return createHmac('sha256', env.INTERNAL_NOTIFY_SECRET)
    .update(`${projectId}:${imgId}:${exp}`)
    .digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Read the binary payload back (streamed by the BFF handler).
 */
export async function readReferenceImage(storageKey: string): Promise<Buffer> {
  return readFile(join(uploadDir(), storageKey));
}
