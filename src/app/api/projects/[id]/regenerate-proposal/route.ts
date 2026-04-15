import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectAccess(auth, id);

    let projectId: ObjectId;
    try {
      projectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const db = await getDb();

    const project = await db.collection('projects').findOne({ _id: projectId, deletedAt: null });

    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    const proposal = await db.collection('proposals').findOne({ projectId });

    if (!proposal) {
      return error('NOT_FOUND', '未找到该项目的提案', 404);
    }

    if (proposal.status !== 'stale') {
      return error('CONFLICT', '提案当前状态不允许重新生成，仅当状态为 stale 时可操作', 409);
    }

    // P0-4: supersede the old run before flipping status so any lingering
    // resume of the stale thread is inert.
    const oldRunId = project.workflowRunId as string | undefined;
    if (oldRunId) {
      await workflowClient.supersedeRun(oldRunId);
    }

    await db
      .collection('proposals')
      .updateOne(
        { projectId },
        { $set: { status: 'generating', updatedAt: new Date().toISOString() } },
      );

    // P0-5: actually kick off the Python workflow to rebuild the proposal
    // from existing spatial layouts. Previously this route just flipped
    // status and returned 202, leaving the button dead.
    await workflowClient.regenerateProposal(id);

    return success({ message: '正在重新生成提案文档...', previousStatus: 'stale' }, 202);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    if (err instanceof WorkflowServiceError) {
      return error('WORKFLOW_ERROR', '工作流服务暂时不可用，请稍后重试', 503);
    }
    return error('INTERNAL_ERROR', '重新生成提案失败', 500);
  }
}
