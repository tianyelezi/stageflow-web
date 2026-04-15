import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectOwner } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';

const STEPS_AFTER_DIRECTION_SELECTION = [
  'alignment',
  'generating_layouts',
  'spatial_review',
  'generating_proposal',
  'completed',
];

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectOwner(auth, id);

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

    if (!STEPS_AFTER_DIRECTION_SELECTION.includes(project.status as string)) {
      return error(
        'CONFLICT',
        '项目当前状态不允许重置创意方向，需要在方向选择之后的步骤才可重置',
        409,
      );
    }

    // P0-4: supersede the old LangGraph run before mutating Mongo so stale
    // checkpoints can't be resumed against diverged business data. A new run
    // is expected to be started by the follow-up select-direction call.
    const oldRunId = project.workflowRunId as string | undefined;
    if (oldRunId) {
      await workflowClient.supersedeRun(oldRunId);
    }

    await Promise.all([
      db
        .collection('creative_directions')
        .updateOne({ projectId }, { $unset: { selectedDirectionId: '' } }),
      db.collection('designer_alignments').deleteMany({ projectId }),
      db.collection('spatial_layouts').deleteMany({ projectId }),
      db.collection('proposals').deleteMany({ projectId }),
      db
        .collection('projects')
        .updateOne(
          { _id: projectId },
          {
            $set: { status: 'direction_selection', updatedAt: new Date().toISOString() },
            $unset: { workflowRunId: '' },
          },
        ),
    ]);

    return success({
      status: 'direction_selection',
      message: '已重置，请重新选择创意方向',
      clearedSteps: ['alignment', 'spatial_layouts', 'proposal'],
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
    return error('INTERNAL_ERROR', '重置创意方向失败', 500);
  }
}
