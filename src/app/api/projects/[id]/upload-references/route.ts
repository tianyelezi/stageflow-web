import { NextRequest } from 'next/server';

import { AuthError, ForbiddenError, requireAuth } from '@/lib/auth';
import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { requireProjectAccess } from '@/lib/rbac';
import { referenceUrlFor, storeReferenceImage } from '@/lib/reference-storage';

const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    await requireProjectAccess(auth, id);

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return error('VALIDATION_ERROR', '无效的项目 ID', 400);
    }

    const db = await getDb();
    const project = await db.collection('projects').findOne({ _id: objectId, deletedAt: null });
    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    if (files.length === 0) {
      return error('VALIDATION_ERROR', '请选择至少一张参考图', 400);
    }
    if (files.length > MAX_FILES) {
      return error('VALIDATION_ERROR', `最多上传 ${MAX_FILES} 张参考图`, 400);
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return error(
          'VALIDATION_ERROR',
          `不支持的文件格式: ${file.type}，请使用 JPG/PNG/WebP`,
          400,
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return error('VALIDATION_ERROR', `文件 ${file.name} 超过 5MB 限制`, 400);
      }
    }

    // Reserve ObjectIds up front so the storage key matches the Mongo _id.
    const docs = files.map((file) => ({
      _id: new ObjectId(),
      file,
    }));

    // Persist each binary to storage, then batch insert metadata.
    const refDocs = await Promise.all(
      docs.map(async ({ _id, file }) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const stored = await storeReferenceImage({
          projectId: id,
          imgId: _id.toHexString(),
          filename: file.name,
          contentType: file.type,
          buffer,
        });
        return {
          _id,
          projectId: objectId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          storageKey: stored.storageKey,
          uploadedAt: new Date().toISOString(),
        };
      }),
    );

    await db.collection('reference_images').insertMany(refDocs);

    const imageIds = refDocs.map((d) => d._id.toHexString());
    const imageUrls = refDocs.map((d) => referenceUrlFor(d.storageKey));

    return success({ imageIds, imageUrls });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return error('UNAUTHORIZED', err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      return error('FORBIDDEN', err.message, 403);
    }
    return error('INTERNAL_ERROR', '上传参考图失败', 500);
  }
}
