import { NextRequest, NextResponse } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { readReferenceImage, referenceUrlFor } from '@/lib/reference-storage';

/**
 * Return a URL the caller (browser or Python workflow) can use to fetch
 * the reference image.
 *
 * - In the S3/OSS future this will 302 to a short-lived presigned URL.
 * - For the local-filesystem minimal implementation we either 302 to the
 *   public `/uploads/...` path (browsers) or stream the bytes back when
 *   called with `?raw=1` (used by Python service).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imgId: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id, imgId } = await params;
    await requireProjectAccess(auth, id);

    let projectOid: ObjectId;
    let imgOid: ObjectId;
    try {
      projectOid = new ObjectId(id);
      imgOid = new ObjectId(imgId);
    } catch {
      return error('VALIDATION_ERROR', '无效的 ID', 400);
    }

    const db = await getDb();
    const doc = await db.collection('reference_images').findOne({
      _id: imgOid,
      projectId: projectOid,
    });
    if (!doc || !doc.storageKey) {
      return error('NOT_FOUND', '参考图不存在', 404);
    }

    const raw = request.nextUrl.searchParams.get('raw') === '1';
    if (raw) {
      const buffer = await readReferenceImage(doc.storageKey as string);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': (doc.contentType as string) ?? 'application/octet-stream',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    return NextResponse.redirect(new URL(referenceUrlFor(doc.storageKey as string), request.url));
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '获取参考图失败', 500);
  }
}
