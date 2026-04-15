/**
 * Role-Based Access Control for StageFlow.
 *
 * Single-owner model: whoever creates a project runs the whole workflow
 * end-to-end. There is no designer invitation / handoff step. Role
 * (admin / event_company / designer) only gates:
 *   - admin: bypasses project ownership checks (back-office access)
 *   - event_company & designer: full access to projects they created
 */

import type { ObjectId as ObjectIdType } from 'mongodb';

import { AuthError, ForbiddenError } from '@/lib/auth';
import { getDb, ObjectId } from '@/lib/db';
import type { UserRole } from '@/types';

interface AuthContext {
  userId: string;
  role: UserRole;
}

export function requireRole(auth: AuthContext, ...allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(auth.role)) {
    throw new ForbiddenError('权限不足');
  }
}

/**
 * Grants access to the project creator (or admin). Used on all
 * per-project workflow actions.
 */
export async function requireProjectAccess(
  auth: AuthContext,
  projectId: string | ObjectIdType,
): Promise<void> {
  if (auth.role === 'admin') return;

  const db = await getDb();
  const oid = typeof projectId === 'string' ? new ObjectId(projectId) : projectId;
  const project = await db.collection('projects').findOne({ _id: oid, deletedAt: null });

  if (!project) {
    throw new AuthError('项目不存在');
  }

  if (project.userId?.toString() !== auth.userId) {
    throw new ForbiddenError('无权访问此项目');
  }
}
