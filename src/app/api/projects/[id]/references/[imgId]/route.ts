import { NextRequest, NextResponse } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { readReferenceImage, verifyReferenceSignature } from '@/lib/reference-storage';

/**
 * Reference image fetch. Two auth paths:
 *
 * 1. Short-lived HMAC-signed URL (`?sig=&exp=`) — used by the Python
 *    workflow service during vision calls. No cookie needed; the
 *    signature expires in 10 minutes by default.
 * 2. Cookie + requireProjectAccess — used by browsers.
 *
 * Bytes are always streamed through this handler. Files are stored
 * outside ``public/`` so the Next static server cannot serve them
 * directly.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imgId: string }> },
) {
  try {
    const { id, imgId } = await params;
    const sig = request.nextUrl.searchParams.get('sig');
    const expRaw = request.nextUrl.searchParams.get('exp');

    // --- Path 1: HMAC-signed URL ---------------------------------------
    if (sig && expRaw) {
      const exp = Number.parseInt(expRaw, 10);
      if (!verifyReferenceSignature(id, imgId, exp, sig)) {
        return error('UNAUTHORIZED', '签名无效或已过期', 401);
      }
      // signature already binds projectId + imgId; only validate the image
      // exists and return the bytes.
    } else {
      // --- Path 2: cookie-based auth -----------------------------------
      const auth = await requireAuth();
      await requireProjectAccess(auth, id);
    }

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
