import { FrameParser } from "./frame/parser.js"
import { serializeFrame } from "./frame/serializer.js"
import { CommandSession } from "./command/session.js"
import { type SessionOptions } from "./command/types.js"
import { type SerialDriver } from "./serial/driver.js"
import { debug } from "./logging/logger.js"

export class RadioController {
  private driver: SerialDriver
  private parser = new FrameParser()
  private queue: CommandSession[] = []
  private activeOp: CommandSession | null = null
  private broadcastHandlers = new Set<(frame: string) => void>()
  private errorHandlers = new Set<(error: Error) => void>()
  private unsubs: (() => void)[] = []
  private _isOpen = false

  constructor(driver: SerialDriver) {
    this.driver = driver
    this.parser.onMalformedFrame((error) => {
      this.emitError(error)
    })
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  async open(path: string): Promise<void> {
    await this.driver.open(path)
    this._isOpen = true

    this.unsubs.push(
      this.driver.onData((data) => this.onSerialData(data)),
    )
    this.unsubs.push(
      this.driver.onError((error) => this.emitError(error)),
    )
    this.unsubs.push(
      this.driver.onClose(() => this.onSerialClose()),
    )
  }

  async close(): Promise<void> {
    this.cancelActiveOp()
    for (const op of this.queue) {
      op.cancel()
    }
    this.queue = []

    for (const unsub of this.unsubs) {
      unsub()
    }
    this.unsubs = []
    this._isOpen = false
    await this.driver.close()
  }

  send(command: string, options: SessionOptions): CommandSession {
    const session = new CommandSession(command, options)
    session._onDone = () => {
      if (this.activeOp === session) {
        this.activeOp = null
        this.processQueue()
      }
    }
    this.queue.push(session)
    this.processQueue()
    return session
  }

  onBroadcast(handler: (frame: string) => void): () => void {
    this.broadcastHandlers.add(handler)
    return () => { this.broadcastHandlers.delete(handler) }
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler)
    return () => { this.errorHandlers.delete(handler) }
  }

  private processQueue(): void {
    if (this.activeOp !== null || this.queue.length === 0) return

    const op = this.queue.shift()!
    this.activeOp = op
    op._startAckTimer()
    const raw = serializeFrame(op.command)
    debug(">>", op.command)
    this.driver.write(raw)
  }

  private onSerialData(data: Uint8Array): void {
    const frames = this.parser.feed(data)
    for (const frame of frames) {
      this.routeFrame(frame)
    }
  }

  private routeFrame(frame: string): void {
    if (this.activeOp !== null) {
      const consumed = this.activeOp.feedFrame(frame)
      if (consumed) {
        debug("<<", `${frame}  (session: ${this.activeOp.command})`)
        return
      }
    }

    debug("<<", `${frame}  (broadcast)`)
    for (const handler of this.broadcastHandlers) {
      handler(frame)
    }
  }

  private cancelActiveOp(): void {
    if (this.activeOp !== null) {
      this.activeOp.cancel()
      this.activeOp = null
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error)
    }
  }

  private onSerialClose(): void {
    this.cancelActiveOp()
    this._isOpen = false
  }
}
