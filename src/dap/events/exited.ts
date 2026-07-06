import { z } from "zod";
import { EventSchema } from "./event";

export const ExitedSchema = z.object({
    event: z.literal("exited")
}).extend(EventSchema.shape);