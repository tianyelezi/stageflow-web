/**
 * Role-Based Access Control for StageFlow.
 *
 * Three roles: admin, event_company, designer
 * Authorization checks run in BFF Route Handlers after requireAuth().
 */

import type { ObjectId as ObjectIdType } from 'mongodb';

import { AuthError, ForbiddenError } from '@/lib/auth';
import { getDb, ObjectId } from '@/lib/db';
import type { UserRole } from '@/types';

interface AuthContext {
  userId: string;
  role: UserRole;
}

// === Role checks ===

export function requireRole(auth: AuthContext, ...allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(auth.role)) {
    throw new ForbiddenError('权限不足');
  }
}

// === Project ownership checks ===

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

  // Allow access if user is the project creator OR the invited designer
  const isOwner = project.userId?.toString() === auth.userId;
  const isDesigner = project.designerId?.toString() === auth.userId;

  if (!isOwner && !isDesigner) {
    throw new ForbiddenError('无权访问此项目');
  }
}

export async function requireProjectOwner(
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
    throw new ForbiddenError('只有项目创建者可以执行此操作');
  }
}

export async function requireDesignerOnProject(
  auth: AuthContext,
  projectId: string | ObjectIdType,
): Promise<void> {
  if (auth.role === 'admin') return;

  if (auth.role !== 'designer') {
    throw new ForbiddenError('只有设计师可以执行此操作');
  }

  const db = await getDb();
  const oid = typeof projectId === 'string' ? new ObjectId(projectId) : projectId;
  const project = await db.collection('projects').findOne({ _id: oid, deletedAt: null });

  if (!project) {
    throw new AuthError('项目不存在');
  }

  if (project.designerId?.toString() !== auth.userId) {
    throw new ForbiddenError('您不是此项目的设计师');
  }
}

/**
 * Designer-centric actions (answer alignment questions, resubmit alignment).
 *
 * Per docs/architecture.md RBAC matrix:
 *   - always allowed for the assigned designer
 *   - allowed for the project owner ONLY when no designer has been invited
 *   - always allowed for admin
 */
export async function requireDesignerOrOwnerIfNoDesigner(
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

  const isOwner = project.userId?.toString() === auth.userId;
  const isDesigner = project.designerId?.toString() === auth.userId;
  const hasDesigner = Boolean(project.designerId);

  if (isDesigner) return;
  if (isOwner && !hasDesigner) return;

  if (isOwner && hasDesigner) {
    throw new ForbiddenError('项目已邀请设计师，仅设计师可回答对齐问题');
  }
  throw new ForbiddenError('无权执行此操作');
}
