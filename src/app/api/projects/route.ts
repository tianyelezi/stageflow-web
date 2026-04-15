import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const searchParams = request.nextUrl.searchParams;

    const page = Math.max(
      1,
      parseInt(searchParams.get('page') ?? String(DEFAULT_PAGE), 10) || DEFAULT_PAGE,
    );
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      ),
    );
    const status = searchParams.get('status') ?? undefined;

    const db = await getDb();
    const filter: Record<string, unknown> = { deletedAt: null };
    if (status) {
      filter.status = status;
    }
    if (auth.role !== 'admin') {
      filter.userId = new ObjectId(auth.userId);
    }

    const skip = (page - 1) * limit;

    const [projects, total] = await Promise.all([
      db
        .collection('projects')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('projects').countDocuments(filter),
    ]);

    const projectList = projects.map((p) => ({
      id: p._id.toHexString(),
      userId: p.userId?.toHexString() ?? null,
      companyName: p.companyName,
      eventType: p.eventType,
      eventName: p.eventName,
      status: p.status,
      progress: p.progress,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return success({
      items: projectList,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '获取项目列表失败', 500);
  }
}
