import { z } from "zod";

export const EventSchema = z.object({
    type: z.literal("event")
});