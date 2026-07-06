import { z } from "zod";
import { EventSchema } from "./event";


export const ContinuedSchema = z.object({
    event: z.literal("continued")
}).extend(EventSchema.shape);