import { z } from "zod";
import { SourceSchema } from "./source";
import { SourceBreakpointSchema } from "./source_breakpoint";

export const SetBreakpointsArgumentsSchema = z.object({
  source: SourceSchema,
  breakpoints: z.array(SourceBreakpointSchema).optional()
});

export type SetBreakpointsArguments = z.infer<typeof SetBreakpointsArgumentsSchema>;