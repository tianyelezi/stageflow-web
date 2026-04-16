/**
 * Server-side authentication utilities.
 * JWT token creation/verification + password hashing + cookie management.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import { getRedis } from '@/lib/redis';
import type { UserRole } from '@/types';

const SALT_ROUNDS = 12;
const COOKIE_NAME = 'token';
const BLOCKLIST_PREFIX = 'token:blocked:';

// === Password ===

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// === JWT ===

interface TokenPayload {
  userId: string;
  role: UserRole;
}

export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as string & jwt.SignOptions['expiresIn'],
    jwtid: crypto.randomUUID(),
  });
}

export function verifyToken(
  token: string,
): (TokenPayload & { jti?: string; exp?: number; iat?: number }) | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload & {
      jti?: string;
      exp?: number;
      iat?: number;
    };
  } catch {
    return null;
  }
}

// === Cookie ===

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.HTTPS_ENABLED === 'true',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

// === Token blocklist (Redis) ===

export async function blockToken(jti: string, ttlSeconds: number): Promise<void> {
  const client = await getRedis();
  await client.set(`${BLOCKLIST_PREFIX}${jti}`, '1', { EX: ttlSeconds });
}

export async function isTokenBlocked(jti: string): Promise<boolean> {
  const client = await getRedis();
  const result = await client.get(`${BLOCKLIST_PREFIX}${jti}`);
  return result !== null;
}

// === Auth check (for Route Handlers) ===

export async function requireAuth(): Promise<TokenPayload> {
  const token = await getTokenFromCookie();
  if (!token) {
    throw new AuthError('未登录');
  }
  const payload = verifyToken(token);
  if (!payload) {
    throw new AuthError('登录已过期');
  }

  // Check blocklist
  if (payload.jti) {
    const blocked = await isTokenBlocked(payload.jti);
    if (blocked) {
      throw new AuthError('登录已过期');
    }
  }

  return payload;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = '权限不足') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
