import { z } from "zod";

/** Every AI output is parsed against one of these before the app uses it. */

export const draftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(6000),
  /** Things the business must confirm before sending (the model was told not to invent them). */
  needsConfirmation: z.array(z.string().max(300)).max(10),
});

export const questionsSchema = z.object({
  questions: z.array(z.string().min(1).max(300)).min(1).max(8),
});

export const summarySchema = z.object({
  summary: z.string().min(1).max(1500),
  keyPoints: z.array(z.string().max(300)).max(8),
});

export const NEXT_ACTIONS = ["reply_now", "request_information", "offer_appointment", "send_follow_up", "wait_for_customer", "close_enquiry"] as const;

export const nextActionSchema = z.object({
  action: z.enum(NEXT_ACTIONS),
  reason: z.string().min(1).max(500),
});

export type Draft = z.infer<typeof draftSchema>;
export type Questions = z.infer<typeof questionsSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
