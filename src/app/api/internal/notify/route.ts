import { NextRequest } from 'next/server';
import { z } from 'zod';

import { success, error } from '@/lib/api-response';
import { getDb, ObjectId } from '@/lib/db';
import { env } from '@/lib/env';
import { verifyInternalHmac } from '@/lib/internal-hmac';

/**
 * Internal endpoint called by the Python workflow when it finishes a run.
 * The frontend-driven notify-complete call has been deprecated (P0-7) so
 * that notifications don't depend on someone keeping the page open.
 *
 * Request is HMAC-signed with the shared secret INTERNAL_NOTIFY_SECRET:
 *   X-Stageflow-Timestamp: <unix seconds>
 *   X-Stageflow-Signature: hex(hmac_sha256(secret, timestamp + "." + body))
 */

const bodySchema = z.object({
  projectId: z.string(),
  event: z.literal('proposal_ready'),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();

    const verdict = verifyInternalHmac({
      secret: env.INTERNAL_NOTIFY_SECRET,
      headers: {
        timestamp: request.headers.get('x-stageflow-timestamp'),
        signature: request.headers.get('x-stageflow-signature'),
      },
      body: raw,
    });
    if (!verdict.ok) {
      return error('UNAUTHORIZED', `internal signature invalid: ${verdict.reason}`, 401);
    }

    let parsed: z.infer<typeof bodySchema>;
    try {
      parsed = bodySchema.parse(JSON.parse(raw));
    } catch {
      return error('VALIDATION_ERROR', 'invalid payload', 400);
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(parsed.projectId);
    } catch {
      return error('VALIDATION_ERROR', '项目 ID 格式无效', 400);
    }

    const db = await getDb();
    const project = await db.collection('projects').findOne({ _id: objectId, deletedAt: null });
    if (!project) {
      return error('NOT_FOUND', '项目不存在', 404);
    }

    if (project.completionNotified) {
      return success({ message: 'already notified' });
    }

    const owner = await db.collection('users').findOne({ _id: project.userId });
    if (owner) {
      const { sendProposalReady } = await import('@/lib/email');
      await sendProposalReady(owner.email, owner.name, project.eventName);
    }

    await db
      .collection('projects')
      .updateOne({ _id: objectId }, { $set: { completionNotified: true } });

    return success({ message: 'notified' });
  } catch {
    return error('INTERNAL_ERROR', '内部通知失败', 500);
  }
}
