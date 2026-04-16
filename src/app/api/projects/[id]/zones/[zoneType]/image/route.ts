import { NextRequest, NextResponse } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { error } from '@/lib/api-response';
import { requireProjectAccess } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';

/**
 * Auth-gated zone image fetch.
 *
 * The images bucket is private in production; the bare URL stored on
 * each zone isn't reachable. This handler (like the proposal download
 * route) asks the workflow service for a short-lived presigned URL
 * and 302s to it so browsers can render ``<img>`` directly.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; zoneType: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id, zoneType } = await params;
    await requireProjectAccess(auth, id);

    const { url } = await workflowClient.getZoneImageUrl(id, zoneType);
    return NextResponse.redirect(url, { status: 302 });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    if (err instanceof WorkflowServiceError) {
      if (err.status === 404) {
        return error('NOT_FOUND', '区域效果图不存在', 404);
      }
      return error('WORKFLOW_ERROR', '工作流服务不可用', 503);
    }
    return error('INTERNAL_ERROR', '获取图片失败', 500);
  }
}
