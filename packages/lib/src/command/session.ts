import { type SendResult, type SessionOptions } from "./types.js"

export class CommandSession {
  readonly command: string
  readonly ack: Promise<SendResult>
  readonly promise: Promise<unknown>

  /** @internal called by RadioController when session completes */
  _onDone: (() => void) | null = null

  private resolveAck: ((result: SendResult) => void) | null = null
  private readonly responseHandlers = new Set<(frame: string) => void>()
  private responseWindow = false
  private responseWindowTimer: ReturnType<typeof setTimeout> | null = null
  private cancelled = false
  private resolveDone: (() => void) | null = null
  private readonly options: SessionOptions

  constructor(command: string, options: SessionOptions) {
    this.command = command
    this.options = {
      ackTimeoutMs: 100,
      responseWindowMs: 500,
      ...options,
    }

    this.ack = new Promise<SendResult>((resolve) => {
      this.resolveAck = resolve
    })
    this.promise = new Promise<void>((resolve) => {
      this.resolveDone = resolve
    })
    this.promise.then(() => this._onDone?.())
  }

  /** @internal called by RadioController when session becomes active */
  _startAckTimer(): void {
    setTimeout(() => {
      if (this.cancelled || this.responseWindow) return
      this.resolveAck?.({ kind: "timeout" })
      this.cancel()
    }, this.options.ackTimeoutMs)
  }

  onResponse(handler: (frame: string) => void): () => void {
    this.responseHandlers.add(handler)
    return () => {
      this.responseHandlers.delete(handler)
    }
  }

  feedFrame(frame: string): boolean {
    if (this.cancelled) return false

    if (frame === "f") {
      this.resolveAck?.({ kind: "fail" })
      this.cancel()
      return true
    }

    if (!this.responseWindow) {
      const stripped = this.options.ackMatcher(frame)
      if (stripped !== null) {
        if (this.options.responseWindowMs !== undefined && this.options.responseWindowMs > 0) {
          this.responseWindow = true
          this.resolveAck?.({ kind: "ack", frame: stripped })
          this.responseWindowTimer = setTimeout(() => {
            this.closeResponseWindow()
          }, this.options.responseWindowMs)
        } else {
          this.resolveAck?.({ kind: "ack", frame: stripped })
          this.cancel()
        }
        return true
      }
      return false
    }

    for (const handler of this.responseHandlers) {
      handler(frame)
    }
    return true
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.responseHandlers.clear()
    if (this.responseWindowTimer !== null) {
      clearTimeout(this.responseWindowTimer)
      this.responseWindowTimer = null
    }
    if (!this.responseWindow) {
      this.resolveAck?.({ kind: "timeout" })
    }
    this.finish()
  }

  private closeResponseWindow(): void {
    this.responseWindow = false
    this.finish()
  }

  private finish(): void {
    this.resolveDone?.()
    this.resolveDone = null
  }
}
