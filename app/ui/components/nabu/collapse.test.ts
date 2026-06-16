import { describe, it, expect } from "vitest"
import {
  collapsePendingTail,
  injectContinuePrompt,
  isStepStackSegment,
  type KeyedSegment,
  type StepStackSegment,
} from "./collapse"
import type { PlanStepMessage } from "./group"
import type { AskMessage } from "./messages"

const step = (status: PlanStepMessage["status"], checkpoint = false): KeyedSegment => ({
  key: `step-${status}-${Math.random()}`,
  segment: { type: "plan-step", description: "s", status, checkpoint, nested: false },
})

const ask: KeyedSegment = {
  key: "ask",
  segment: { type: "ask", question: "q", options: [], selected: null } as AskMessage,
}

const stackOf = (segments: KeyedSegment[]): StepStackSegment | undefined =>
  segments.map((s) => s.segment).find(isStepStackSegment)

describe("collapsePendingTail", () => {
  it("≤4 pending → unchanged (auto-expanded)", () => {
    const segments = [step("completed"), step("active"), step("pending"), step("pending")]
    expect(collapsePendingTail(segments)).toBe(segments)
  })

  it(">4 pending with no ask/checkpoint → still folds; active stays visible", () => {
    const pending = Array.from({ length: 15 }, () => step("pending"))
    const out = collapsePendingTail([step("active"), ...pending])
    expect(out.map((s) => s.segment.type)).toEqual(["plan-step", "step-stack"])
    expect(stackOf(out)?.steps).toHaveLength(15)
  })

  it("≤4 pending after an ask → unchanged (auto-expanded)", () => {
    const segments = [ask, step("pending"), step("pending"), step("pending"), step("pending")]
    expect(collapsePendingTail(segments)).toBe(segments)
  })

  it(">4 pending after an ask → folded into one step-stack", () => {
    const pending = [
      step("pending"),
      step("pending"),
      step("pending"),
      step("pending"),
      step("pending"),
    ]
    const out = collapsePendingTail([ask, ...pending])
    expect(out).toHaveLength(2)
    expect(stackOf(out)?.steps).toHaveLength(5)
  })

  it("completed steps after the boundary stay visible; only pending fold", () => {
    const out = collapsePendingTail([
      ask,
      step("completed"),
      step("active"),
      step("pending"),
      step("pending"),
      step("pending"),
      step("pending"),
      step("pending"),
    ])
    const types = out.map((s) => s.segment.type)
    expect(types).toEqual(["ask", "plan-step", "plan-step", "step-stack"])
    expect(stackOf(out)?.steps).toHaveLength(5)
  })

  it("an active checkpoint also opens a collapse boundary", () => {
    const pending = Array.from({ length: 5 }, () => step("pending"))
    const out = collapsePendingTail([step("active", true), ...pending])
    expect(stackOf(out)?.steps).toHaveLength(5)
  })
})

describe("injectContinuePrompt", () => {
  it("inserts a continue prompt after an active checkpoint when waiting", () => {
    const out = injectContinuePrompt([step("active", true), step("pending")], true)
    expect(out.map((s) => s.segment.type)).toEqual(["plan-step", "continue-prompt", "plan-step"])
  })

  it("does nothing when not waiting", () => {
    const segments = [step("active", true), step("pending")]
    expect(injectContinuePrompt(segments, false)).toBe(segments)
  })
})
