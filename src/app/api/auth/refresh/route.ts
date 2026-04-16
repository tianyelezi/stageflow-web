import { success, error } from '@/lib/api-response';
import {
  blockToken,
  createToken,
  getTokenFromCookie,
  isTokenBlocked,
  setAuthCookie,
  verifyToken,
} from '@/lib/auth';
import { getDb, ObjectId } from '@/lib/db';

export async function POST() {
  try {
    const token = await getTokenFromCookie();
    if (!token) {
      return error('UNAUTHORIZED', '未登录', 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return error('UNAUTHORIZED', '登录已过期，请重新登录', 401);
    }

    // Reject refresh for already-blocked tokens (e.g. after logout).
    if (payload.jti && (await isTokenBlocked(payload.jti))) {
      return error('UNAUTHORIZED', '登录已过期，请重新登录', 401);
    }

    // Verify user still exists and is active
    const db = await getDb();
    const user = await db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.userId), isActive: true });

    if (!user) {
      return error('UNAUTHORIZED', '用户不存在或已停用', 401);
    }

    // Rotate: block the old jti (by its remaining TTL) so a leaked old
    // token can't be reused even though a new one is issued now.
    if (payload.jti && typeof payload.exp === 'number') {
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      if (remaining > 0) {
        await blockToken(payload.jti, remaining);
      }
    }

    const newToken = createToken({ userId: payload.userId, role: user.role });
    await setAuthCookie(newToken);

    return success({ userId: payload.userId, role: user.role });
  } catch {
    return error('INTERNAL_ERROR', '刷新失败', 500);
  }
}
