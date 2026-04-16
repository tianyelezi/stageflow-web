import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readReferenceImage,
  referenceUrlFor,
  storeReferenceImage,
  verifyReferenceSignature,
} from '@/lib/reference-storage';

describe('reference-storage (local fs + HMAC signed URLs)', () => {
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
    const buffer = Buffer.from([0xff, 0xd8, 0xff]);

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

  it('referenceUrlFor emits a signed BFF URL with sig+exp', () => {
    const url = referenceUrlFor('proj1', 'img1');
    expect(url).toMatch(/^\/api\/projects\/proj1\/references\/img1\?sig=[a-f0-9]{64}&exp=\d+$/);
  });

  it('referenceUrlFor prefixes PUBLIC_BASE_URL when set', () => {
    process.env.PUBLIC_BASE_URL = 'https://stageflow.example.com';
    const url = referenceUrlFor('proj1', 'img1');
    expect(url.startsWith('https://stageflow.example.com/api/projects/proj1/references/img1?')).toBe(
      true,
    );
  });

  it('verifyReferenceSignature accepts a fresh signature', () => {
    const url = referenceUrlFor('proj1', 'img1');
    const { searchParams } = new URL(url, 'http://test');
    const sig = searchParams.get('sig')!;
    const exp = Number(searchParams.get('exp'));
    expect(verifyReferenceSignature('proj1', 'img1', exp, sig)).toBe(true);
  });

  it('verifyReferenceSignature rejects a wrong project or imgId', () => {
    const url = referenceUrlFor('proj1', 'img1');
    const { searchParams } = new URL(url, 'http://test');
    const sig = searchParams.get('sig')!;
    const exp = Number(searchParams.get('exp'));
    expect(verifyReferenceSignature('proj2', 'img1', exp, sig)).toBe(false);
    expect(verifyReferenceSignature('proj1', 'img2', exp, sig)).toBe(false);
  });

  it('verifyReferenceSignature rejects an expired signature', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 1;
    // Any sig — should fail fast on the exp check
    const fakeSig = 'a'.repeat(64);
    expect(verifyReferenceSignature('proj1', 'img1', pastExp, fakeSig)).toBe(false);
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
