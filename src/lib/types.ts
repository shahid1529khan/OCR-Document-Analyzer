import { z } from "zod";

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  created_at: z.string(),
  page_count: z.number().nullable(),
});
