import { z } from "zod";
import { EventSchema } from "./event";
import { SourceSchema } from "../source";

export const OutputSchema = z.object({
    event: z.literal("output"),
    body: z.looseObject({})
}).extend(EventSchema.shape);

export type Output = z.infer<typeof OutputSchema>;