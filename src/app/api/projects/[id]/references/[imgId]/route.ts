import { NextRequest, NextResponse } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { readReferenceImage } from '@/lib/reference-storage';

/**
 * Auth-gated reference image fetch.
 *
 * Previously this route 302'd to the public `/uploads/...` path, which
 * meant anyone with the URL could bypass requireProjectAccess by calling
 * the static path directly. Now the bytes are always streamed through
 * this handler so project authorization is enforced on every fetch.
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

    const buffer = await readReferenceImage(doc.storageKey as string);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': (doc.contentType as string) ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
      },
    });
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
