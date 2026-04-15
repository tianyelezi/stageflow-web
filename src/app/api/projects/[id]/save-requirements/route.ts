import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectAccess(auth, id);

    const body = await request.json();
    const requirements = typeof body?.requirements === 'string' ? body.requirements.trim() : '';

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const db = await getDb();
    await db.collection('projects').updateOne(
      { _id: objectId, deletedAt: null },
      {
        $set: {
          clientRequirements: requirements,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    return success({ message: '补充信息已保存' });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '保存失败', 500);
  }
}
