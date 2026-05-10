import { z } from "zod"

const BaseUx = z.object({
  selectedCodes: z.array(z.string()).optional(),
})

export const uxSchema = () => BaseUx

export const UxSchema = uxSchema()
export type Ux = z.infer<typeof BaseUx>
