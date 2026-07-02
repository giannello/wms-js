import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RadioController } from "./controller.js"
import { MockSerialDriver } from "./testing/mock-serial.js"
import { ackMatch } from "./command/ack-match.js"

const enc = (s: string) => new TextEncoder().encode(s)

describe("RadioController", () => {
  let driver: MockSerialDriver
  let controller: RadioController

  beforeEach(async () => {
    vi.useFakeTimers()
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
    vi.useRealTimers()
  })

  describe("open / close", () => {
    it("opens the serial driver", () => {
      expect(controller.isOpen).toBe(true)
      expect(driver.isOpen).toBe(true)
    })

    it("close releases the driver", async () => {
      await controller.close()
      expect(controller.isOpen).toBe(false)
      expect(driver.isOpen).toBe(false)
    })
  })

  describe("send()", () => {
    it("resolves ack on matched frame", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      driver.simulateData(enc("{a}"))

      const result = await session.ack
      expect(result).toEqual({ kind: "ack", frame: "" })
    })

    it("resolves with fail on {f}", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      driver.simulateData(enc("{f}"))

      const result = await session.ack
      expect(result).toEqual({ kind: "fail" })
    })

    it("resolves with timeout after configured timeout", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), ackTimeoutMs: 100, responseWindowMs: 0 })

      vi.advanceTimersByTime(100)

      const result = await session.ack
      expect(result).toEqual({ kind: "timeout" })
    })

    it("writes serialized frame to driver", async () => {
      controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      await vi.waitFor(() => {
        const writes = driver.getWrites()
        expect(writes.length).toBe(1)
        expect(new TextDecoder().decode(writes[0])).toBe("{CMD}")
      })
    })

    it("prefix matcher strips prefix from frame", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.prefix("g"), responseWindowMs: 0 })
      driver.simulateData(enc("{gWMS USB-Stick}"))

      const result = await session.ack
      expect(result).toEqual({ kind: "ack", frame: "WMS USB-Stick" })
    })
  })

  describe("response window", () => {
    it("routes response frames after ack when window is open", () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })
      const handler = vi.fn()
      session.onResponse(handler)

      driver.simulateData(enc("{a}{RES:data1}{RES:data2}"))

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith("RES:data1")
      expect(handler).toHaveBeenCalledWith("RES:data2")
    })

    it("auto-closes response window after timeout", () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })
      const handler = vi.fn()
      session.onResponse(handler)

      driver.simulateData(enc("{a}"))
      vi.advanceTimersByTime(500)

      driver.simulateData(enc("{RES:late}"))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe("queue", () => {
    it("processes send() calls sequentially", async () => {
      const results: string[] = []

      controller.send("CMD1", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
        .ack.then(() => results.push("CMD1"))
      controller.send("CMD2", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
        .ack.then(() => results.push("CMD2"))

      driver.simulateData(enc("{a}"))
      await vi.waitFor(() => expect(results).toEqual(["CMD1"]))

      driver.simulateData(enc("{a}"))
      await vi.waitFor(() => expect(results).toEqual(["CMD1", "CMD2"]))
    })

    it("queues second send until first completes", async () => {
      const s1 = controller.send("S1", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })
      const s2 = controller.send("S2", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })

      let s2started = false
      s2.ack.then(() => { s2started = true })

      driver.simulateData(enc("{a}"))
      expect(s2started).toBe(false)

      vi.advanceTimersByTime(500)

      driver.simulateData(enc("{a}"))
      await vi.waitFor(() => expect(s2started).toBe(true))
    })
  })

  describe("broadcast", () => {
    it("routes unmatched frames to broadcast handlers", () => {
      const handler = vi.fn()
      controller.onBroadcast(handler)

      driver.simulateData(enc("{BROADCAST}"))

      expect(handler).toHaveBeenCalledWith("BROADCAST")
    })

    it("does not route matched ack frames to broadcast", () => {
      const handler = vi.fn()
      controller.onBroadcast(handler)

      controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      driver.simulateData(enc("{a}"))

      expect(handler).not.toHaveBeenCalled()
    })

    it("routes response window frames to broadcast after session completes", () => {
      const handler = vi.fn()
      controller.onBroadcast(handler)

      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 500 })
      driver.simulateData(enc("{a}"))
      vi.advanceTimersByTime(500)

      driver.simulateData(enc("{POST_SESSION}"))
      expect(handler).toHaveBeenCalledWith("POST_SESSION")
    })
  })

  describe("errors", () => {
    it("forwards serial errors", () => {
      const handler = vi.fn()
      controller.onError(handler)

      driver.simulateError(new Error("serial error"))

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ message: "serial error" }),
      )
    })

    it("forwards malformed frame errors", () => {
      const handler = vi.fn()
      controller.onError(handler)

      controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      driver.simulateData(enc("{partial"))
      vi.advanceTimersByTime(1000)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: "MalformedFrameError" }),
      )
    })
  })

  describe("close behavior", () => {
    it("cancels active operation on close", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), ackTimeoutMs: 10000, responseWindowMs: 0 })
      await controller.close()

      const result = await session.ack
      expect(result).toEqual({ kind: "timeout" })
    })

    it("drains queue on close", async () => {
      const session = controller.send("CMD", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      controller.send("CMD2", { ackMatcher: ackMatch.exact("a"), responseWindowMs: 0 })
      await controller.close()

      const result = await session.ack
      expect(result).toEqual({ kind: "timeout" })
    })
  })
})
