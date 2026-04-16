import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { normalizeToCamelCase } from '@/lib/normalize';
import { requireProjectAccess } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const projectIdParam = request.nextUrl.searchParams.get('projectId');
    if (!projectIdParam) {
      return error('VALIDATION_ERROR', 'projectId 参数不能为空', 400);
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(projectIdParam);
    } catch {
      return error('VALIDATION_ERROR', 'projectId 格式无效', 400);
    }

    await requireProjectAccess(auth, projectIdParam);

    const db = await getDb();

    const [
      project,
      brandResearch,
      visualElements,
      creativeDirections,
      designerAlignment,
      spatialLayouts,
      proposal,
    ] = await Promise.all([
      db.collection('projects').findOne({ _id: objectId, deletedAt: null }),
      db.collection('brand_research_results').findOne({ projectId: objectId }),
      db.collection('visual_elements').findOne({ projectId: objectId }),
      db.collection('creative_directions').findOne({ projectId: objectId }),
      db.collection('designer_alignments').findOne({ projectId: objectId }),
      db.collection('spatial_layouts').findOne({ projectId: objectId }),
      db.collection('proposals').findOne({ projectId: objectId }),
    ]);

    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    // Derive actual status from available data (more reliable than project.status
    // which may not be updated by the workflow engine)
    const derivedStatus = deriveStatus(project, {
      brandResearch,
      visualElements,
      creativeDirections,
      designerAlignment,
      spatialLayouts,
      proposal,
    });

    return success({
      project: {
        id: project._id.toHexString(),
        companyName: project.companyName,
        eventType: project.eventType,
        eventName: project.eventName,
        status: derivedStatus.status,
        progress: derivedStatus.progress,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      brandResearch: brandResearch ? normalizeToCamelCase(stripMongoId(brandResearch)) : null,
      visualElements: visualElements ? normalizeToCamelCase(stripMongoId(visualElements)) : null,
      creativeDirections: creativeDirections
        ? normalizeToCamelCase(stripMongoId(creativeDirections))
        : null,
      designerAlignment: designerAlignment
        ? normalizeToCamelCase(stripMongoId(designerAlignment))
        : null,
      spatialLayouts: spatialLayouts
        ? rewriteZoneImageUrls(
            normalizeToCamelCase(stripMongoId(spatialLayouts)) as Record<string, unknown>,
            project._id.toHexString(),
          )
        : null,
      proposal: proposal ? normalizeToCamelCase(stripMongoId(proposal)) : null,
      currentStep: project.status,
      progress: project.progress,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '获取结果失败', 500);
  }
}

function stripMongoId(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, projectId, ...rest } = doc;
  return rest;
}

function rewriteZoneImageUrls(
  layouts: Record<string, unknown>,
  projectId: string,
): Record<string, unknown> {
  const zones = layouts.zones as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(zones)) return layouts;
  layouts.zones = zones.map((z) => {
    const zoneType = z.type as string | undefined;
    const hasKey = Boolean(z.imageKey ?? z.image_key);
    if (zoneType && hasKey) {
      return {
        ...z,
        imageUrl: `/api/projects/${projectId}/zones/${encodeURIComponent(zoneType)}/image`,
      };
    }
    return z;
  });
  return layouts;
}

interface DataPresence {
  brandResearch: unknown;
  visualElements: unknown;
  creativeDirections: unknown;
  designerAlignment: unknown;
  spatialLayouts: unknown;
  proposal: unknown;
}

function deriveStatus(
  project: Record<string, unknown>,
  data: DataPresence,
): { status: string; progress: number } {
  // If project has explicit completed status, trust it
  if (project.status === 'completed') {
    return { status: 'completed', progress: 100 };
  }

  // Derive from available data (most advanced stage wins)
  if (data.proposal) {
    return { status: 'completed', progress: 100 };
  }
  if (data.spatialLayouts) {
    return { status: 'proposal_ready', progress: 90 };
  }

  const alignment = data.designerAlignment as Record<string, unknown> | null;
  if (alignment?.alignmentStatus === 'completed') {
    return { status: 'generating_layouts', progress: 60 };
  }
  if (alignment?.questions) {
    return { status: 'alignment', progress: 55 };
  }

  const directions = data.creativeDirections as Record<string, unknown> | null;
  if (directions?.selectedDirectionId) {
    return { status: 'alignment', progress: 55 };
  }
  if (directions?.directions) {
    return { status: 'direction_selection', progress: 50 };
  }

  if (data.visualElements) {
    return { status: 'visual_suggestions', progress: 35 };
  }

  if (data.brandResearch) {
    const br = data.brandResearch as Record<string, unknown>;
    if (br.confirmedAt || (br.userCorrections !== undefined && br.userCorrections !== null)) {
      return { status: 'visual_suggestions', progress: 25 };
    }
    return { status: 'research_review', progress: 20 };
  }

  // No data yet — still researching
  return { status: (project.status as string) ?? 'researching', progress: 0 };
}
