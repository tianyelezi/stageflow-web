/**
 * Reference-image storage.
 *
 * MINIMAL VIABLE IMPLEMENTATION:
 * Currently writes uploaded files to the local filesystem under
 * `<REFERENCE_UPLOAD_DIR>/<projectId>/<imgId><ext>` and returns a
 * `/uploads/references/...` URL that is served as static assets by Next.
 *
 * TODO(P0-3): Replace with real object storage once @aws-sdk/client-s3 is
 * added to the workspace dependencies. The storage abstraction below is
 * designed so only `putObject` / `getUrl` need swapping — callers stay
 * unchanged. See docs/reviews/p0-3 note in the adversarial review.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DEFAULT_UPLOAD_DIR = join(process.cwd(), 'public', 'uploads', 'references');

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
  storageKey: string; // Opaque key persisted in Mongo; future S3 object key.
  url: string; // URL Python workflow can fetch (absolute when PUBLIC_BASE_URL set).
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
    url: referenceUrlFor(relKey),
  };
}

/**
 * Build the URL Python workflow can fetch. Falls back to a path that Next
 * serves from /public. Set PUBLIC_BASE_URL in production so Python can fetch
 * absolute URLs.
 */
export function referenceUrlFor(storageKey: string): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
  const path = `/uploads/references/${storageKey}`;
  return base ? `${base}${path}` : path;
}

/**
 * Read the binary payload back out (used by the dev-mode proxy route).
 */
export async function readReferenceImage(storageKey: string): Promise<Buffer> {
  return readFile(join(uploadDir(), storageKey));
}
