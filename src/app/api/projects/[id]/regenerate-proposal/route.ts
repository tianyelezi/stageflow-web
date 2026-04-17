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

    // Check if spatial layouts exist — we need zones to generate a proposal
    const layouts = await db.collection('spatial_layouts').findOne({ projectId });
    if (!layouts?.zones?.length) {
      return error('CONFLICT', '空间设计尚未完成，无法生成提案', 409);
    }

    // P0-4: supersede the old run before starting a fresh one
    const oldRunId = project.workflowRunId as string | undefined;
    if (oldRunId) {
      await workflowClient.supersedeRun(oldRunId).catch(() => {});
    }

    // Mark any existing proposal as generating (or create the intent)
    await db
      .collection('proposals')
      .updateOne(
        { projectId },
        { $set: { status: 'generating', updatedAt: new Date().toISOString() } },
        { upsert: true },
      );

    // Reset project status so the UI shows progress
    await db.collection('projects').updateOne(
      { _id: projectId },
      { $set: { status: 'generating_layouts', progress: 85, updatedAt: new Date().toISOString() }, $unset: { error: '' } },
    );

    await workflowClient.regenerateProposal(id);

    return success({ message: '正在重新生成提案文档...' }, 202);
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
