import { describe, expect, it } from "vitest"
import { findProjectById, shouldAutoSelect, getFirstProjectId, resolveState } from "./useProjects"
import type { ProjectSummary } from "~/lib/server/api/queries"

const createProject = (id: string, name: string): ProjectSummary => ({
  id,
  name,
  description: "",
  version: 1,
  healthy: true,
  pinned: false,
})

describe("findProjectById", () => {
  const cases = [
    {
      name: "finds project by id",
      projects: [createProject("1", "Project 1"), createProject("2", "Project 2")],
      id: "2",
      expected: { id: "2", name: "Project 2" },
    },
    {
      name: "returns undefined for non-existent id",
      projects: [createProject("1", "Project 1")],
      id: "999",
      expected: undefined,
    },
    {
      name: "returns undefined for null id",
      projects: [createProject("1", "Project 1")],
      id: null,
      expected: undefined,
    },
    {
      name: "returns undefined for empty projects",
      projects: [],
      id: "1",
      expected: undefined,
    },
  ]

  it.each(cases)("$name", ({ projects, id, expected }) => {
    const result = findProjectById(projects, id)
    if (expected === undefined) {
      expect(result).toBeUndefined()
    } else {
      expect(result?.id).toBe(expected.id)
      expect(result?.name).toBe(expected.name)
    }
  })
})

describe("shouldAutoSelect", () => {
  const cases = [
    {
      name: "returns true when projects exist and no value selected",
      projects: [createProject("1", "Project 1")],
      currentValue: null,
      expected: true,
    },
    {
      name: "returns false when projects exist and value is selected",
      projects: [createProject("1", "Project 1")],
      currentValue: "1",
      expected: false,
    },
    {
      name: "returns false when no projects exist",
      projects: [],
      currentValue: null,
      expected: false,
    },
    {
      name: "returns false when no projects and value somehow set",
      projects: [],
      currentValue: "1",
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ projects, currentValue, expected }) => {
    expect(shouldAutoSelect(projects, currentValue)).toBe(expected)
  })
})

describe("getFirstProjectId", () => {
  const cases = [
    {
      name: "returns first project id",
      projects: [createProject("1", "First"), createProject("2", "Second")],
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

describe("resolveState", () => {
  const cases = [
    {
      name: "returns loading when loading is true",
      loading: true,
      error: null,
      projects: [],
      expected: "loading",
    },
    {
      name: "returns error when error exists",
      loading: false,
      error: new Error("Failed"),
      projects: [],
      expected: "error",
    },
    {
      name: "returns empty when no projects",
      loading: false,
      error: null,
      projects: [],
      expected: "empty",
    },
    {
      name: "returns ready when projects exist",
      loading: false,
      error: null,
      projects: [createProject("1", "Project")],
      expected: "ready",
    },
    {
      name: "loading takes priority over error",
      loading: true,
      error: new Error("Failed"),
      projects: [],
      expected: "loading",
    },
    {
      name: "error takes priority over empty",
      loading: false,
      error: new Error("Failed"),
      projects: [createProject("1", "Project")],
      expected: "error",
    },
  ]

  it.each(cases)("$name", ({ loading, error, projects, expected }) => {
    expect(resolveState(loading, error, projects)).toBe(expected)
  })
})
