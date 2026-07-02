import { type RadioController } from "../controller.js"

type DispatchEntry = {
  matcher: (frame: string) => unknown
  handler: (msg: unknown) => void
}

export class BroadcastRouter {
  private radio: RadioController
  private entries: DispatchEntry[] = []
  private unsubBroadcast: (() => void) | null = null

  constructor(radio: RadioController) {
    this.radio = radio
  }

  on<T>(matcher: (frame: string) => T | null, handler: (msg: T) => void): () => void {
    const entry: DispatchEntry = {
      matcher: matcher as (frame: string) => unknown,
      handler: handler as (msg: unknown) => void,
    }
    this.entries.push(entry)

    if (this.unsubBroadcast === null) {
      this.unsubBroadcast = this.radio.onBroadcast((frame) => {
        this.dispatch(frame)
      })
    }

    return () => {
      const idx = this.entries.indexOf(entry)
      if (idx !== -1) {
        this.entries.splice(idx, 1)
      }
      if (this.entries.length === 0 && this.unsubBroadcast !== null) {
        this.unsubBroadcast()
        this.unsubBroadcast = null
      }
    }
  }

  private dispatch(frame: string): void {
    for (const entry of this.entries) {
      const result = entry.matcher(frame)
      if (result !== null) {
        entry.handler(result)
        return
      }
    }
  }
}
