/**
 * Email notification service using Resend.
 * Sends notifications at key workflow milestones.
 * Gracefully no-ops if RESEND_API_KEY is not configured.
 */

import { Resend } from 'resend';

import { env } from '@/lib/env';

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  return new Resend(env.RESEND_API_KEY);
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    await client.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    return true;
  } catch {
    return false;
  }
}

// === Notification templates ===

export async function sendProposalReady(
  ownerEmail: string,
  ownerName: string,
  projectName: string,
): Promise<boolean> {
  return sendEmail(
    ownerEmail,
    `[StageFlow] 项目「${projectName}」提案已生成`,
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a73e8;">提案生成完成</h2>
      <p>${ownerName} 您好，</p>
      <p>项目「<strong>${projectName}</strong>」的设计提案已生成完毕。</p>
      <p>请登录 StageFlow 查看提案内容，下载 PDF 和 PPTX 文件。</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #666; font-size: 12px;">此邮件由 StageFlow 自动发送</p>
    </div>
    `,
  );
}
