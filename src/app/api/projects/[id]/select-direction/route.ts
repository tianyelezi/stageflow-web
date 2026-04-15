import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectOwner } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';
import { selectDirectionSchema } from '@/lib/validations/project';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectOwner(auth, id);

    const body: unknown = await request.json();
    const parsed = selectDirectionSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return error(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? '请求参数无效',
        400,
        details,
      );
    }

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

    if (!project.workflowRunId) {
      return error('WORKFLOW_ERROR', '项目工作流未启动', 400);
    }

    const { directionId } = parsed.data;

    await workflowClient.resumeWorkflow(project.workflowRunId as string, 'direction_selection', {
      selected_direction_id: directionId,
    });

    // Notify designer if assigned (non-blocking)
    if (project.designerId) {
      const { sendAlignmentReady } = await import('@/lib/email');
      const designer = await db.collection('users').findOne({ _id: project.designerId });
      if (designer) {
        sendAlignmentReady(designer.email, designer.name, project.eventName).catch(() => {});
      }
    }

    return success({
      status: 'alignment',
      message: '方向已选择，正在生成设计师对齐问题...',
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
    return error('INTERNAL_ERROR', '选择方向失败', 500);
  }
}
