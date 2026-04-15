import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readReferenceImage,
  referenceUrlFor,
  storeReferenceImage,
} from '@/lib/reference-storage';

describe('reference-storage (local fs MVP)', () => {
  let dir: string;
  const ORIGINAL_BASE = process.env.PUBLIC_BASE_URL;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refs-'));
    process.env.REFERENCE_UPLOAD_DIR = dir;
    delete process.env.PUBLIC_BASE_URL;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.REFERENCE_UPLOAD_DIR;
    if (ORIGINAL_BASE) process.env.PUBLIC_BASE_URL = ORIGINAL_BASE;
  });

  it('writes the uploaded buffer to disk under projectId/imgId<ext>', async () => {
    const projectId = 'p123';
    const imgId = 'img1';
    const buffer = Buffer.from([0xff, 0xd8, 0xff]); // JPEG magic bytes

    const stored = await storeReferenceImage({
      projectId,
      imgId,
      filename: 'logo.JPG',
      contentType: 'image/jpeg',
      buffer,
    });

    expect(stored.storageKey).toBe(`${projectId}/${imgId}.jpg`);
    const written = await readFile(join(dir, stored.storageKey));
    expect(written.equals(buffer)).toBe(true);
  });

  it('referenceUrlFor prefixes PUBLIC_BASE_URL when set', () => {
    process.env.PUBLIC_BASE_URL = 'https://stageflow.example.com';
    expect(referenceUrlFor('p1/x.png')).toBe(
      'https://stageflow.example.com/uploads/references/p1/x.png',
    );
  });

  it('referenceUrlFor returns root-relative path when base not set', () => {
    expect(referenceUrlFor('p1/x.png')).toBe('/uploads/references/p1/x.png');
  });

  it('readReferenceImage round-trips the bytes', async () => {
    const buffer = Buffer.from('hello world');
    const stored = await storeReferenceImage({
      projectId: 'p1',
      imgId: 'i1',
      filename: 'f.webp',
      contentType: 'image/webp',
      buffer,
    });
    const read = await readReferenceImage(stored.storageKey);
    expect(read.toString()).toBe('hello world');
  });
});
