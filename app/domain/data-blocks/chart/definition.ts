import { ChartSchema, type ChartBlock } from "./schema"
import type { BlockTypeConfig } from "~/lib/data-blocks/definition"
import type { ValidationError } from "~/lib/data-blocks/validate"

// Loaded on demand: validation reaches the database and the file store, and the
// registry this definition sits in is read from the block-parse path, which those
// two import back.
const validateOnDemand = async (parsed: ChartBlock): Promise<ValidationError[]> => {
  const { validateChartQuery } = await import("./validate")
  return validateChartQuery(parsed)
}

export const jsonChart: BlockTypeConfig<ChartBlock> = {
  schema: () => ChartSchema,
  readonly: [],
  immutable: {
    id: 'Field "id" is immutable',
  },
  constraints: [],
  renderer: "chart",
  singleton: false,
  projected: true,
  tableName: "charts",
  // `spec` is a discriminated union, so it flattens to one VARCHAR holding
  // "[object Object]". The column answers every query and says nothing.
  hiddenColumns: ["spec"],
  labelKey: "caption.label",
  captionType: "Figure",
  idPaths: [{ path: "id", prefix: "chart" }],
  asyncValidate: validateOnDemand,
}
