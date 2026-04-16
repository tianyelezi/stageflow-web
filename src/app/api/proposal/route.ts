import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { normalizeToCamelCase } from '@/lib/normalize';
import { requireProjectAccess } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const projectIdParam = request.nextUrl.searchParams.get('projectId');
    if (!projectIdParam) {
      return error('VALIDATION_ERROR', 'projectId 参数不能为空', 400);
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(projectIdParam);
    } catch {
      return error('VALIDATION_ERROR', 'projectId 格式无效', 400);
    }

    await requireProjectAccess(auth, projectIdParam);

    const db = await getDb();
    const proposal = await db.collection('proposals').findOne({ projectId: objectId });

    if (!proposal) {
      return error('NOT_FOUND', '未找到该项目的提案', 404);
    }

    const { _id, projectId: _pid, ...rest } = proposal;
    const normalized = normalizeToCamelCase(rest) as Record<string, unknown>;

    // Swap bare S3/MinIO URLs for auth-gated BFF download endpoints so
    // clients never receive presigned or public URLs directly. Clients
    // call GET /api/proposal/download?projectId=...&kind=pdf which 302s
    // to a fresh 10-minute signed URL after requireProjectAccess.
    const storageKeys = (normalized.storageKeys ?? {}) as {
      pdf?: string | null;
      pptx?: string | null;
    };
    const urls: Record<string, string | null> = {
      pdf: storageKeys.pdf
        ? `/api/proposal/download?projectId=${projectIdParam}&kind=pdf`
        : null,
      pptx: storageKeys.pptx
        ? `/api/proposal/download?projectId=${projectIdParam}&kind=pptx`
        : null,
      imagesPack: null,
    };
    normalized.documentUrls = urls;
    delete normalized.storageKeys;

    return success(normalized);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '获取提案失败', 500);
  }
}
