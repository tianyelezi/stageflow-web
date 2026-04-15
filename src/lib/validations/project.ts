import { z } from 'zod';

export const submitProjectSchema = z.object({
  companyName: z.string().min(2, '公司名称至少2个字符').max(100, '公司名称不超过100个字符'),
  eventType: z.enum(['annual_meeting', 'product_launch', 'award_ceremony', 'gala', 'custom']),
  eventName: z.string().min(2, '活动名称至少2个字符').max(200, '活动名称不超过200个字符'),
  industry: z.string().optional(),
  eventDate: z.string().datetime().optional(),
  venueInfo: z
    .object({
      name: z.string(),
      dimensions: z.object({
        width: z.number().positive(),
        depth: z.number().positive(),
        height: z.number().positive(),
      }),
      capacity: z.number().int().positive(),
    })
    .optional(),
  budget: z.enum(['low', 'medium', 'high', 'premium']).optional(),
  additionalRequirements: z.string().max(2000, '附加要求不超过2000个字符').optional(),
  researchProvider: z.enum(['openai', 'gemini']).default('openai'),
  templateId: z.string().optional(),
});

export type SubmitProjectInput = z.infer<typeof submitProjectSchema>;

export const confirmResearchSchema = z.object({
  confirmed: z.literal(true),
  corrections: z.string().optional(),
  referenceImageIds: z.array(z.string()).optional(),
});

export type ConfirmResearchInput = z.infer<typeof confirmResearchSchema>;

export const selectDirectionSchema = z.object({
  directionId: z.string().min(1, '请选择一个有效的创意方向'),
});

export type SelectDirectionInput = z.infer<typeof selectDirectionSchema>;

export const alignmentAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z.string().min(1, '请回答此问题'),
      }),
    )
    .min(1, '请至少回答一个问题'),
});

export type AlignmentAnswersInput = z.infer<typeof alignmentAnswersSchema>;

export const regenerateZoneSchema = z.object({
  zoneType: z.enum([
    'main_stage',
    'photo_wall',
    'entrance',
    'check_in_desk',
    'history_wall',
    'honor_wall',
    'interactive_zone',
  ]),
  additionalNotes: z.string().optional(),
});

export type RegenerateZoneInput = z.infer<typeof regenerateZoneSchema>;
