import { z } from "zod"

export const HYDE_ANGLES = ["direct", "hedged", "consequence"] as const
export const HYDES_PER_ANGLE = 2
export const HYDE_COUNT = HYDE_ANGLES.length * HYDES_PER_ANGLE

export const HydeAngleSchema = z.object({
  type: z.enum(HYDE_ANGLES),
  text: z.string(),
})

export const HydeListSchema = z.array(HydeAngleSchema).length(HYDE_COUNT)

export type HydeAngle = z.infer<typeof HydeAngleSchema>
