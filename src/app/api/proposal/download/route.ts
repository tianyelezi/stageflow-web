import { NextRequest, NextResponse } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { error } from '@/lib/api-response';
import { requireProjectAccess } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';

/**
 * Auth-gated proposal download.
 *
 * The proposals bucket is private in production; the bare URL written
 * at generation time isn't reachable. This endpoint asks the workflow
 * service for a fresh short-lived presigned URL and 302s to it, so the
 * browser download works while the signed URL never leaks to clients
 * that haven't proven project access.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const projectId = request.nextUrl.searchParams.get('projectId');
    const kind = request.nextUrl.searchParams.get('kind');

    if (!projectId) {
      return error('VALIDATION_ERROR', 'projectId 参数不能为空', 400);
    }
    if (kind !== 'pdf' && kind !== 'pptx') {
      return error('VALIDATION_ERROR', "kind 必须为 'pdf' 或 'pptx'", 400);
    }

    await requireProjectAccess(auth, projectId);

    const { url } = await workflowClient.getProposalDownloadUrl(projectId, kind);
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
        return error('NOT_FOUND', '提案文件不存在', 404);
      }
      return error('WORKFLOW_ERROR', '工作流服务不可用', 503);
    }
    return error('INTERNAL_ERROR', '下载失败', 500);
  }
}
