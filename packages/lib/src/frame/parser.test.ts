import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FrameParser } from "./parser.js"

const enc = (s: string) => new TextEncoder().encode(s)

describe("FrameParser", () => {
  let parser: FrameParser

  beforeEach(() => {
    vi.useFakeTimers()
    parser = new FrameParser()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("extracts a single frame", () => {
    const frames = parser.feed(enc("{hello}"))
    expect(frames).toEqual(["hello"])
  })

  it("extracts multiple frames in one chunk", () => {
    const frames = parser.feed(enc("{a}{b}{c}"))
    expect(frames).toEqual(["a", "b", "c"])
  })

  it("ignores content outside braces", () => {
    const frames = parser.feed(enc("foo{bar}baz"))
    expect(frames).toEqual(["bar"])
  })

  it("handles empty frame", () => {
    const frames = parser.feed(enc("{}"))
    expect(frames).toEqual([""])
  })

  it("handles partial frame across chunks", () => {
    expect(parser.feed(enc("{hel"))).toEqual([])
    expect(parser.feed(enc("lo}"))).toEqual(["hello"])
  })

  it("handles nested-like braces as content (no nesting)", () => {
    const frames = parser.feed(enc("{foo{bar}"))
    expect(frames).toEqual(["foo{bar"])
  })

  it("handles trailing stray closing brace", () => {
    const frames = parser.feed(enc("{hello}}"))
    expect(frames).toEqual(["hello"])
  })

  it("handles leading stray closing brace", () => {
    const frames = parser.feed(enc("}{hello}"))
    expect(frames).toEqual(["hello"])
  })

  it("handles empty input", () => {
    const frames = parser.feed(enc(""))
    expect(frames).toEqual([])
  })

  it("extracts multiple frames across chunks", () => {
    expect(parser.feed(enc("{a}{b"))).toEqual(["a"])
    expect(parser.feed(enc("}{c}"))).toEqual(["b", "c"])
  })

  it("fires malformed frame error after timeout", () => {
    const handler = vi.fn()
    parser.onMalformedFrame(handler)

    parser.feed(enc("{hello"))

    vi.advanceTimersByTime(1000)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ partial: "{hello" }),
    )
  })

  it("does not fire malformed error if frame completes before timeout", () => {
    const handler = vi.fn()
    parser.onMalformedFrame(handler)

    parser.feed(enc("{hello"))
    parser.feed(enc("world}"))

    vi.advanceTimersByTime(1000)

    expect(handler).not.toHaveBeenCalled()
  })

  it("discards partial content after malformed timeout", () => {
    const handler = vi.fn()
    parser.onMalformedFrame(handler)

    parser.feed(enc("{hello"))
    vi.advanceTimersByTime(1000)

    const frames = parser.feed(enc("{world}"))
    expect(frames).toEqual(["world"])
  })

  it("fires malformed error only once per partial frame", () => {
    const handler = vi.fn()
    parser.onMalformedFrame(handler)

    parser.feed(enc("{hello"))
    vi.advanceTimersByTime(2000)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("reset clears buffer and pending timer", () => {
    const handler = vi.fn()
    parser.onMalformedFrame(handler)

    parser.feed(enc("{hello"))
    parser.reset()

    vi.advanceTimersByTime(1000)
    expect(handler).not.toHaveBeenCalled()
  })

  it("handles utf-8 content", () => {
    const frames = parser.feed(enc("{café}"))
    expect(frames).toEqual(["café"])
  })
})
