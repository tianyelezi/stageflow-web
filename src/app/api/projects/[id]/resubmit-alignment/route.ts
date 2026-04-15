import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireDesignerOrOwnerIfNoDesigner } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';

interface AlignmentAnswer {
  questionId: string;
  answer: string;
}

function isValidAnswers(value: unknown): value is AlignmentAnswer[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).questionId === 'string' &&
      typeof (item as Record<string, unknown>).answer === 'string',
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireDesignerOrOwnerIfNoDesigner(auth, id);

    let projectId: ObjectId;
    try {
      projectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      return error('VALIDATION_ERROR', '请求体无效', 400);
    }

    const { answers } = body as { answers: unknown };

    if (!isValidAnswers(answers)) {
      return error(
        'VALIDATION_ERROR',
        'answers 必须是包含 questionId 和 answer 字段的对象数组',
        400,
      );
    }

    const db = await getDb();
    const project = await db.collection('projects').findOne({ _id: projectId, deletedAt: null });

    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    const runId = project.workflowRunId as string | undefined;
    if (!runId) {
      return error('CONFLICT', '该项目没有关联的工作流', 409);
    }

    // P0-4: supersede the old run so the workflow state doesn't fork from
    // the business data we're about to delete. The caller is expected to
    // start a new workflow run via the normal flow; for now we still call
    // resume on the old run for backward compatibility, but the supersede
    // call makes the old checkpoint inert if that path changes later.
    await workflowClient.supersedeRun(runId);

    await Promise.all([
      db.collection('spatial_layouts').deleteMany({ projectId }),
      db.collection('proposals').deleteMany({ projectId }),
    ]);

    // NOTE: resume on the superseded run_id will now fail-fast (thread was
    // cleared). Long-term we must start a new run here — see
    // docs/reviews/p0-4-plan.md. For the interim, downgrade this route to
    // request the caller re-enter from alignment.
    await workflowClient.resumeWorkflow(runId, 'alignment_answers', { answers });

    return success({
      status: 'generating_layouts',
      message: '对齐答案已更新，正在重新生成空间布局...',
      clearedSteps: ['spatial_layouts', 'proposal'],
    });
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
    return error('INTERNAL_ERROR', '重新提交对齐答案失败', 500);
  }
}
