import { z } from "zod";
import { SourceSchema } from "./source";

export const SourceBreakpointSchema = z.object({
  line: z.int(),
  condition: z.string().optional(),
});

export type SourceBreakpoint = z.infer<typeof SourceBreakpointSchema>;