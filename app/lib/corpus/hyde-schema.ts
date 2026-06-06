import { z } from "zod"

export const HYDE_ANGLES = ["direct", "hedged", "consequence", "signal"] as const
export const HYDE_COUNT = 9

export const HydeAngleSchema = z.object({
  type: z.enum(HYDE_ANGLES),
  text: z.string(),
})

export const HydeListSchema = z.array(HydeAngleSchema).length(HYDE_COUNT)

export type HydeAngle = z.infer<typeof HydeAngleSchema>
