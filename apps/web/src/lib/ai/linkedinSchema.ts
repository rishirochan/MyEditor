import { z } from "zod";
// Relative + explicit extension so `node --test src/lib/ai/linkedin.test.ts`
// runs this module with no loader, alias resolver, or build step.
import { LINKEDIN_SECTIONS, stripLatex } from "./linkedin.ts";

export const linkedinUpdateSchema = z.object({
  section: z.enum(LINKEDIN_SECTIONS),
  label: z.string().trim().min(1).max(200),
  current: z.string().max(4000).default(""),
  proposed: z
    .string()
    .min(1)
    .max(4000)
    .transform((value) => stripLatex(value)),
});

export const linkedinResponseSchema = z.object({
  reply: z.string().trim().min(1).max(8000),
  updates: z
    .array(linkedinUpdateSchema)
    .max(30)
    // A model can strip an entry down to nothing; drop those rather than
    // showing the member an empty card to copy.
    .transform((updates) => updates.filter((u) => u.proposed.length > 0)),
});
