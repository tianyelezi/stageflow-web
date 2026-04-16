import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectAccess(auth, id);

    const body = await request.json();
    const requirements = typeof body?.requirements === 'string' ? body.requirements.trim() : '';

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const db = await getDb();

    // Keep the raw copy on the project doc for audit; merge it into
    // brand_research_results.userCorrections so the workflow actually
    // reads it (visual_elements / creative_direction / designer_alignment
    // pull from state.user_corrections which is populated from this field
    // on resume). Previously the save-requirements path was dead water.
    await db.collection('projects').updateOne(
      { _id: objectId, deletedAt: null },
      {
        $set: {
          clientRequirements: requirements,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    // Append (or set) on the research doc. Use a marker so the workflow
    // prompts can distinguish brand-research corrections from later client
    // follow-ups, and so multiple saves don't silently duplicate text.
    const MARKER = '\n\n【客户补充需求】\n';
    const existing = await db
      .collection('brand_research_results')
      .findOne({ projectId: objectId });
    const prev = (existing?.userCorrections as string | null | undefined) ?? '';
    const base = prev.split(MARKER)[0] ?? '';
    const merged = requirements
      ? base
        ? `${base}${MARKER}${requirements}`
        : `${MARKER.trimStart()}${requirements}`
      : base;
    await db
      .collection('brand_research_results')
      .updateOne({ projectId: objectId }, { $set: { userCorrections: merged } });

    return success({ message: '补充信息已保存，将在下一次工作流节点执行时生效' });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '保存失败', 500);
  }
}
