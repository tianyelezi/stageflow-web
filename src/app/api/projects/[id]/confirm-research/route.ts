import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { referenceUrlFor } from '@/lib/reference-storage';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';
import { confirmResearchSchema } from '@/lib/validations/project';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectAccess(auth, id);

    const body: unknown = await request.json();
    const parsed = confirmResearchSchema.safeParse(body);
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

    const { corrections, referenceImageIds } = parsed.data;

    // Resolve referenceImageIds → real fetchable URLs for the Python workflow.
    let referenceImageUrls: string[] = [];
    if (referenceImageIds && referenceImageIds.length > 0) {
      const oids: ObjectId[] = [];
      for (const rid of referenceImageIds) {
        try {
          oids.push(new ObjectId(rid));
        } catch {
          return error('VALIDATION_ERROR', `参考图 ID 无效: ${rid}`, 400);
        }
      }
      const refs = await db
        .collection('reference_images')
        .find({ _id: { $in: oids }, projectId: objectId })
        .toArray();
      if (refs.length !== oids.length) {
        return error('VALIDATION_ERROR', '部分参考图不存在或不属于该项目', 400);
      }
      referenceImageUrls = refs
        .map((r) =>
          r.storageKey
            ? referenceUrlFor(String(r.projectId), String(r._id))
            : null,
        )
        .filter((u): u is string => Boolean(u));
    }

    await workflowClient.resumeWorkflow(project.workflowRunId as string, 'research_review', {
      corrections: corrections ?? '',
      reference_image_urls: referenceImageUrls,
    });

    return success({
      status: 'visual_suggestions',
      message: '品牌研究已确认，正在生成视觉建议...',
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
    return error('INTERNAL_ERROR', '确认研究失败', 500);
  }
}
