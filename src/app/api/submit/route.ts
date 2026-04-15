import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireRole } from '@/lib/rbac';
import { workflowClient, WorkflowServiceError } from '@/lib/workflow-client';
import { submitProjectSchema } from '@/lib/validations/project';
import type { InsertOneResult } from 'mongodb';

const MAX_SUBMITS_PER_HOUR = 10;

export async function POST(request: NextRequest) {
  const db = await getDb();
  let insertResult: InsertOneResult | undefined;

  try {
    const auth = await requireAuth();
    // Per docs/architecture.md RBAC matrix: 创建项目 allowed for event_company/admin only.
    await requireRole(auth, 'admin', 'event_company');

    // Per-user rate limit on AI workflow creation
    const limit = await checkRateLimit(`submit:${auth.userId}`, MAX_SUBMITS_PER_HOUR, 3600);
    if (!limit.allowed) {
      return error('RATE_LIMITED', '项目创建过于频繁，请稍后重试', 429);
    }

    const body: unknown = await request.json();

    const parsed = submitProjectSchema.safeParse(body);
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

    const { researchProvider, ...inputFields } = parsed.data;

    const now = new Date().toISOString();
    const projectDoc = {
      ...inputFields,
      userId: new ObjectId(auth.userId),
      researchProvider,
      status: 'researching',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    insertResult = await db.collection('projects').insertOne(projectDoc);
    const projectId = insertResult.insertedId.toHexString();

    const inputData: Record<string, unknown> = {
      company_name: inputFields.companyName,
      event_type: inputFields.eventType,
      event_name: inputFields.eventName,
      industry: inputFields.industry ?? null,
      venue_info: inputFields.venueInfo
        ? {
            name: inputFields.venueInfo.name,
            dimensions: inputFields.venueInfo.dimensions,
            capacity: inputFields.venueInfo.capacity,
          }
        : null,
      budget: inputFields.budget ?? null,
      additional_requirements: inputFields.additionalRequirements ?? null,
      template_overrides: inputFields.templateId ? { template_id: inputFields.templateId } : null,
    };
    const workflowResult = await workflowClient.startWorkflow(
      projectId,
      inputData,
      researchProvider,
    );

    await db
      .collection('projects')
      .updateOne(
        { _id: insertResult.insertedId },
        { $set: { workflowRunId: workflowResult.run_id } },
      );

    return success(
      {
        projectId,
        workflowRunId: workflowResult.run_id,
        status: 'researching',
        sseChannel: `/api/projects/${projectId}/events`,
      },
      202,
    );
  } catch (err: unknown) {
    // Mark project as failed if it was created but workflow failed
    if (insertResult?.insertedId) {
      await db.collection('projects').updateOne(
        { _id: insertResult.insertedId },
        {
          $set: {
            status: 'draft',
            error: 'WORKFLOW_UNAVAILABLE',
            updatedAt: new Date().toISOString(),
          },
        },
      );
    }

    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }

    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }

    if (err instanceof WorkflowServiceError) {
      return error('WORKFLOW_ERROR', '工作流服务暂时不可用，请稍后重试', 503);
    }

    return error('INTERNAL_ERROR', '提交项目失败', 500);
  }
}
