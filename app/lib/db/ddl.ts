import type { DuckDbType, DbColumn, TableSchema, JsonSchema } from "./types"
import { toSnakeCase } from "./naming"

interface TableProjection {
  schemas: TableSchema[]
}

const jsonTypeToDuckDb = (prop: JsonSchema): DuckDbType => {
  if (prop.type === "boolean") return "BOOLEAN"
  if (prop.type === "integer") return "INTEGER"
  if (prop.type === "number") return "DOUBLE"
  if (prop.type === "string" && prop.format === "date") return "DATE"
  if (prop.type === "string" && prop.format === "date-time") return "TIMESTAMP"
  if (prop.type === "array" && prop.items?.type === "string") return "VARCHAR[]"
  if (prop.type === "array" && prop.items?.type === "number") return "FLOAT[]"
  return "VARCHAR"
}

const isObjectArray = (prop: JsonSchema): boolean =>
  prop.type === "array" && prop.items?.type === "object"

const isNestedObject = (prop: JsonSchema): boolean =>
  prop.type === "object" && prop.properties !== undefined

const fileColumn: DbColumn = { name: "file", type: "VARCHAR", nullable: false }

const buildColumns = (schema: JsonSchema, prefix = ""): DbColumn[] => {
  const properties = schema.properties ?? {}
  const columns: DbColumn[] = []

  for (const [name, prop] of Object.entries(properties)) {
    if (isObjectArray(prop)) continue
    const colName = prefix ? `${prefix}_${toSnakeCase(name)}` : toSnakeCase(name)
    if (isNestedObject(prop)) {
      columns.push(...buildColumns(prop, colName))
    } else {
      columns.push({ name: colName, type: jsonTypeToDuckDb(prop), nullable: true })
    }
  }

  return columns
}

const buildChildTable = (
  parentName: string,
  field: string,
  itemSchema: JsonSchema
): TableSchema => ({
  name: `${parentName}_${toSnakeCase(field)}`,
  columns: [fileColumn, ...buildColumns(itemSchema)],
})

const findChildTables = (parentName: string, schema: JsonSchema): TableSchema[] => {
  const properties = schema.properties ?? {}

  return Object.entries(properties)
    .filter(([, prop]) => isObjectArray(prop))
    .map(([field, prop]) => {
      if (!prop.items) throw new Error(`Object array ${field} missing items schema`)
      return buildChildTable(parentName, field, prop.items)
    })
}

export const jsonSchemaToTableProjection = (
  tableName: string,
  jsonSchema: JsonSchema
): TableProjection => {
  const rootSchema: TableSchema = {
    name: tableName,
    columns: [fileColumn, ...buildColumns(jsonSchema)],
  }

  const childTables = findChildTables(tableName, jsonSchema)

  return { schemas: [rootSchema, ...childTables] }
}

const columnDdl = (col: DbColumn): string => {
  const nullability = col.nullable ? "" : " NOT NULL"
  return `  ${col.name} ${col.type}${nullability}`
}

export const filterHiddenColumns = (schema: TableSchema, hidden: string[]): TableSchema => ({
  name: schema.name,
  columns: schema.columns.filter((c) => !hidden.includes(c.name)),
})

export const tableSchemaToDdl = (schema: TableSchema): string => {
  const columns = schema.columns.map(columnDdl).join(",\n")
  return `CREATE OR REPLACE TABLE ${schema.name} (\n${columns}\n);`
}

export const tableSchemaToDescribe = (schema: TableSchema): string => {
  const columns = schema.columns.map(columnDdl).join("\n")
  return `${schema.name}\n${columns}`
}

export const projectionToDdl = (tableName: string, jsonSchema: JsonSchema): string => {
  const { schemas } = jsonSchemaToTableProjection(tableName, jsonSchema)
  return schemas.map(tableSchemaToDdl).join("\n\n")
}
