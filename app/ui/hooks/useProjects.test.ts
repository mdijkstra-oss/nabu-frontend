import { describe, expect, it } from "vitest"
import { getFirstProjectId } from "./useProjects"
import type { Project } from "~/lib/server/api/queries"

const createProject = (id: string): Project => ({ id, updatedAt: "2026-08-06T12:00:00Z" })

describe("getFirstProjectId", () => {
  const cases = [
    {
      name: "returns first project id",
      projects: [createProject("1"), createProject("2")],
      expected: "1",
    },
    {
      name: "returns null for empty projects",
      projects: [],
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ projects, expected }) => {
    expect(getFirstProjectId(projects)).toBe(expected)
  })
})
