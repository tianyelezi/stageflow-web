import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireDesignerOrOwnerIfNoDesigner } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';
import { alignmentAnswersSchema } from '@/lib/validations/project';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireDesignerOrOwnerIfNoDesigner(auth, id);

    const body: unknown = await request.json();
    const parsed = alignmentAnswersSchema.safeParse(body);
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

    const { answers } = parsed.data;

    const workflowAnswers = answers.map((a) => ({
      question_id: a.questionId,
      answer: a.answer,
    }));

    await workflowClient.resumeWorkflow(project.workflowRunId as string, 'alignment_answers', {
      answers: workflowAnswers,
    });

    return success({
      status: 'generating_layouts',
      message: '对齐完成，正在生成空间设计...',
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
    return error('INTERNAL_ERROR', '提交对齐答案失败', 500);
  }
}
