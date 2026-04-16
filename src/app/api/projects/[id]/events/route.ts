import { NextRequest } from 'next/server';

import { createClient } from 'redis';

import { requireAuth } from '@/lib/auth';
import { getDb, ObjectId } from '@/lib/db';
import { env } from '@/lib/env';
import { requireProjectAccess } from '@/lib/rbac';

// Redis Stream replay + blocking reads. See packages/workflow/src/db/
// redis_client.py for the writer side.
const STREAM_KEY_PREFIX = 'sse:stream:';
const XREAD_BLOCK_MS = 15_000;
const HEARTBEAT_MS = 25_000;
const REPLAY_BATCH = 200;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id: projectId } = await params;

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(projectId);
  } catch {
    return new Response('Invalid project ID', { status: 400 });
  }

  try {
    await requireProjectAccess(auth, projectId);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const db = await getDb();
  const project = await db.collection('projects').findOne({ _id: objectId, deletedAt: null });
  if (!project) {
    return new Response('Project not found', { status: 404 });
  }

  // Browsers echo the last received id as Last-Event-ID on reconnect — we
  // replay from there. Programmatic clients can also pass ?lastEventId=. If
  // neither is present, start at "$" (tail only, no replay).
  const lastEventId =
    request.headers.get('last-event-id') ??
    request.nextUrl.searchParams.get('lastEventId') ??
    '$';

  const encoder = new TextEncoder();
  const streamKey = `${STREAM_KEY_PREFIX}${projectId}`;

  const stream = new ReadableStream({
    async start(controller) {
      const redis = createClient({ url: env.REDIS_URL });
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const frame = (id: string, event: string, data: string): string =>
        `id: ${id}\nevent: ${event}\ndata: ${data}\n\n`;

      const tryEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          await redis.quit();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      request.signal.addEventListener('abort', () => {
        void cleanup();
      });

      try {
        await redis.connect();
      } catch (err) {
        try {
          controller.error(err);
        } catch {
          /* ignore */
        }
        return;
      }

      // Suggested client reconnect delay.
      tryEnqueue('retry: 3000\n\n');

      // Heartbeat so idle proxies (nginx, CDN, etc.) don't kill the stream.
      // Comment lines (starting with ':') are ignored by EventSource.
      heartbeatTimer = setInterval(() => {
        tryEnqueue(`: keepalive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      let cursor = lastEventId;
      while (!closed) {
        // XREAD BLOCK returns an array of { name, messages: [{ id, message }] }
        // on node-redis v4. Returns null on timeout.
        type XReadMessage = { id: string; message: Record<string, string> };
        type XReadEntry = { name: string; messages: XReadMessage[] };
        let reply: XReadEntry[] | null = null;
        try {
          reply = (await redis.xRead(
            { key: streamKey, id: cursor },
            { BLOCK: XREAD_BLOCK_MS, COUNT: REPLAY_BATCH },
          )) as XReadEntry[] | null;
        } catch {
          // Redis hiccup — break so the client reconnects (browser will
          // send Last-Event-ID and pick up cleanly).
          break;
        }
        if (!reply) {
          // Timed out with no new messages — loop so heartbeats keep firing.
          continue;
        }
        for (const entry of reply) {
          for (const m of entry.messages) {
            const eventType: string = m.message?.event ?? 'message';
            const data: string = m.message?.data ?? '';
            if (!tryEnqueue(frame(m.id, eventType, data))) break;
            cursor = m.id;
          }
          if (closed) break;
        }
      }

      await cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
