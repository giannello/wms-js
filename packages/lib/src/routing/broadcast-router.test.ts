import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RadioController } from "../controller.js"
import { MockSerialDriver } from "../testing/mock-serial.js"
import { BroadcastRouter } from "./broadcast-router.js"

const enc = (s: string) => new TextEncoder().encode(s)

describe("BroadcastRouter", () => {
  let driver: MockSerialDriver
  let controller: RadioController
  let router: BroadcastRouter

  beforeEach(async () => {
    driver = new MockSerialDriver()
    controller = new RadioController(driver)
    router = new BroadcastRouter(controller)
    await controller.open("/dev/ttyUSB0")
  })

  afterEach(async () => {
    await controller.close()
  })

  it("routes matched frames to handler", () => {
    const matcher = (f: string) => (f === "A" ? { val: "matched" } : null)
    const handler = vi.fn()

    router.on(matcher, handler)
    driver.simulateData(enc("{A}"))

    expect(handler).toHaveBeenCalledWith({ val: "matched" })
  })

  it("skips non-matched frames", () => {
    const matcher = (f: string) => (f === "A" ? { val: "matched" } : null)
    const handler = vi.fn()

    router.on(matcher, handler)
    driver.simulateData(enc("{B}"))

    expect(handler).not.toHaveBeenCalled()
  })

  it("first matching handler wins", () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    router.on(
      (f) => (f === "X" ? { from: 1 } : null),
      handler1,
    )
    router.on(
      (f) => (f === "X" ? { from: 2 } : null),
      handler2,
    )

    driver.simulateData(enc("{X}"))

    expect(handler1).toHaveBeenCalledWith({ from: 1 })
    expect(handler2).not.toHaveBeenCalled()
  })

  it("second handler fires if first does not match", () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    router.on(
      (f) => (f === "A" ? { from: 1 } : null),
      handler1,
    )
    router.on(
      (f) => (f === "B" ? { from: 2 } : null),
      handler2,
    )

    driver.simulateData(enc("{B}"))

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledWith({ from: 2 })
  })

  it("unsubscribe removes handler", () => {
    const matcher = (f: string) => (f === "A" ? {} : null)
    const handler = vi.fn()

    const unsub = router.on(matcher, handler)
    unsub()

    driver.simulateData(enc("{A}"))

    expect(handler).not.toHaveBeenCalled()
  })

  it("unsubscribes from radio when last handler removed", () => {
    const broadcastHandler = vi.fn()
    controller.onBroadcast(broadcastHandler)

    const matcher = (f: string) => (f === "A" ? {} : null)
    const handler = vi.fn()

    const unsub = router.on(matcher, handler)
    unsub()

    // The router's internal broadcast listener should be gone,
    // so frames should fall through to the controller's broadcast handlers
    driver.simulateData(enc("{A}"))

    expect(broadcastHandler).toHaveBeenCalledWith("A")
  })
})
