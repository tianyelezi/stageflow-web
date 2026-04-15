/**
 * Server-side environment variables for BFF.
 * Only import this in Route Handlers and Server Components.
 */

export const env = {
  WORKFLOW_SERVICE_URL: process.env.WORKFLOW_SERVICE_URL ?? 'http://localhost:8000',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME ?? 'stageflow',
  get JWT_SECRET(): string {
    const v = process.env.JWT_SECRET;
    if (!v && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    return v ?? 'stageflow-dev-only-secret';
  },
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'StageFlow <noreply@stageflow.com>',
  get INTERNAL_NOTIFY_SECRET(): string {
    const v = process.env.INTERNAL_NOTIFY_SECRET;
    if (!v && process.env.NODE_ENV === 'production') {
      throw new Error('INTERNAL_NOTIFY_SECRET environment variable is required in production');
    }
    return v ?? 'stageflow-dev-only-internal-secret';
  },
};
