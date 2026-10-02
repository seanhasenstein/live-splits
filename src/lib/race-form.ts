import { z } from "zod";
import { DistanceUnit, Id } from "@/lib/db/schema";

/** What the race form submits (as JSON in a hidden field). */
export const RacePayload = z.object({
  name: z.string().trim().min(1, "Enter a race name").max(80),
  raceCategoryId: z.string().min(1),
  levelIds: z.array(z.string().min(1)).min(1, "Pick at least one level"),
  distanceId: Id,
  scheduledStart: z.iso.time({ precision: -1 }).nullable(),
  checkpoints: z
    .array(
      z.object({
        id: z.string().min(1).nullable(),
        label: z.string().trim().min(1, "Every checkpoint needs a label").max(40),
        value: z.number().positive("Checkpoint distance must be positive"),
        unit: DistanceUnit,
        kind: z.enum(["split", "finish"]),
      }),
    )
    .min(1, "Add at least one checkpoint"),
  lineup: z.array(z.object({ athleteId: Id, levelId: z.string().min(1) })).min(1, "Pick at least one athlete"),
});
export type RacePayload = z.infer<typeof RacePayload>;
