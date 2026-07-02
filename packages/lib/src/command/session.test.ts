import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CommandSession } from "./session.js"
import { ackMatch } from "./ack-match.js"

describe("CommandSession", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves ack on exact match", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })

    session.feedFrame("a")

    const result = await session.ack
    expect(result).toEqual({ kind: "ack", frame: "" })
  })

  it("resolves ack on prefix match with stripped frame", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.prefix("g"), responseWindowMs: 0 })

    session.feedFrame("gWMS USB-Stick")

    const result = await session.ack
    expect(result).toEqual({ kind: "ack", frame: "WMS USB-Stick" })
  })

  it("does not resolve ack when matcher returns null", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })

    let resolved = false
    session.ack.then(() => { resolved = true })

    session.feedFrame("b")
    expect(resolved).toBe(false)
  })

  it("resolves ack as fail on {f}", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })

    session.feedFrame("f")

    const result = await session.ack
    expect(result).toEqual({ kind: "fail" })
  })

  it("times out ack after timeout period", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), ackTimeoutMs: 100, responseWindowMs: 0 })

    vi.advanceTimersByTime(100)

    const result = await session.ack
    expect(result).toEqual({ kind: "timeout" })
  })

  it("does not time out if ack arrives before timeout", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), ackTimeoutMs: 100, responseWindowMs: 0 })

    session.feedFrame("a")
    vi.advanceTimersByTime(200)

    const result = await session.ack
    expect(result).toEqual({ kind: "ack", frame: "" })
  })

  it("opens response window when responseWindowMs > 0", () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

    const handler = vi.fn()
    session.onResponse(handler)
    session.feedFrame("a")
    session.feedFrame("RES:data")

    expect(handler).toHaveBeenCalledWith("RES:data")
  })

  it("closes response window after timeout", () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

    const handler = vi.fn()
    session.onResponse(handler)
    session.feedFrame("a")

    vi.advanceTimersByTime(500)
    session.feedFrame("g")

    expect(handler).not.toHaveBeenCalled()
  })

  it("does not open response window when responseWindowMs is 0", () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })

    const handler = vi.fn()
    session.onResponse(handler)
    session.feedFrame("a")
    session.feedFrame("g")

    expect(handler).not.toHaveBeenCalled()
  })

  it("unsubscribe removes response handler", () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

    const handler = vi.fn()
    const unsub = session.onResponse(handler)
    unsub()

    session.feedFrame("a")
    session.feedFrame("g")

    expect(handler).not.toHaveBeenCalled()
  })

  it("cancel stops response routing immediately", () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

    const handler = vi.fn()
    session.onResponse(handler)
    session.feedFrame("a")

    session.cancel()
    session.feedFrame("g")

    expect(handler).not.toHaveBeenCalled()
  })

  it("cancel before ack resolves ack as timeout", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })

    session.cancel()

    const result = await session.ack
    expect(result).toEqual({ kind: "timeout" })
  })

  it("completes done promise after response window closes", async () => {
    const session = new CommandSession("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

    let done = false
    session.promise.then(() => { done = true })

    session.feedFrame("a")
    await vi.advanceTimersByTimeAsync(500)

    expect(done).toBe(true)
  })
})
