import { z } from "zod";
import { BreakpointSchema } from "../breakpoint";
import { EventSchema } from "./event";

export const BreakpointEventSchema = z.object({
    event: z.literal("breakpoint"),
    body: z.object({
        reason: z.enum(["changed", "new", "removed"]),
        breakpoint: BreakpointSchema
    })
}).extend(EventSchema.shape);

export type BreakpointEvent = z.infer<typeof BreakpointEventSchema>;