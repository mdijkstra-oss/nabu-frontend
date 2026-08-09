import { describe, expect, it } from "vitest"
import { getFirstProjectId, getFirstProjectRedirect, shouldOfferFirstProject } from "./useProjects"
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

describe("getFirstProjectRedirect", () => {
  const cases = [
    {
      name: "navigates to the first project once the list loads",
      projects: [createProject("1"), createProject("2")],
      loading: false,
      expected: "/project/1",
    },
    {
      name: "does not navigate while loading",
      projects: [createProject("1")],
      loading: true,
      expected: null,
    },
    {
      name: "does not navigate with no projects",
      projects: [],
      loading: false,
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ projects, loading, expected }) => {
    expect(getFirstProjectRedirect(projects, loading)).toBe(expected)
  })
})

describe("shouldOfferFirstProject", () => {
  const cases = [
    {
      name: "offers a first project once an empty list has loaded",
      projects: [],
      loading: false,
      expected: true,
    },
    {
      name: "does not offer while loading",
      projects: [],
      loading: true,
      expected: false,
    },
    {
      name: "does not offer when a project exists",
      projects: [createProject("1")],
      loading: false,
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ projects, loading, expected }) => {
    expect(shouldOfferFirstProject(projects, loading)).toBe(expected)
  })
})
