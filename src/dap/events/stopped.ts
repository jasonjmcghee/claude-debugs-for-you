import { z } from "zod";
import { EventSchema } from "./event";

export const StoppedSchema = z.object({
    event: z.literal("stopped"),
    body: z.object({
        threadId: z.number(),
    })
}).extend(EventSchema.shape);