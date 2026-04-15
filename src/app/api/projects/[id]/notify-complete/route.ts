import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';

/**
 * DEPRECATED FRONT-END TRIGGER.
 *
 * As of P0-7, completion emails are sent by the Python workflow via the
 * signed internal endpoint /api/internal/notify. This route is kept only
 * to (a) let the owner manually re-trigger a notification if needed, and
 * (b) preserve backwards compatibility while the frontend call is being
 * removed. It enforces project ownership — previously any logged-in user
 * could trigger an email for any project ID.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const db = await getDb();
    const project = await db.collection('projects').findOne({ _id: objectId, deletedAt: null });

    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    // P0-7: caller must own the project. Previously only login was checked
    // so any authenticated user could spam emails for any project ID.
    const ownerId = (project.userId as { toString(): string } | undefined)?.toString();
    if (!ownerId || ownerId !== auth.userId) {
      return error('FORBIDDEN', '无权对该项目发送通知', 403);
    }

    if (project.status !== 'completed') {
      return error('CONFLICT', '项目未完成', 409);
    }

    if (project.completionNotified) {
      return success({ message: '已通知' });
    }

    const owner = await db.collection('users').findOne({ _id: project.userId });
    if (owner) {
      const { sendProposalReady } = await import('@/lib/email');
      await sendProposalReady(owner.email, owner.name, project.eventName);
    }

    await db
      .collection('projects')
      .updateOne({ _id: objectId }, { $set: { completionNotified: true } });

    return success({ message: '提案完成通知已发送' });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '发送通知失败', 500);
  }
}
