import { MalformedFrameError } from "./errors.js"

const decoder = new TextDecoder("utf-8", { fatal: false })

export class FrameParser {
  private buffer = ""
  private malformedHandler: ((error: MalformedFrameError) => void) | null = null
  private malformedTimer: ReturnType<typeof setTimeout> | null = null
  private readonly partialTimeoutMs: number

  constructor(partialTimeoutMs = 1000) {
    this.partialTimeoutMs = partialTimeoutMs
  }

  onMalformedFrame(handler: (error: MalformedFrameError) => void): () => void {
    this.malformedHandler = handler
    return () => {
      this.malformedHandler = null
    }
  }

  feed(data: Uint8Array): string[] {
    const text = decoder.decode(data, { stream: true })
    this.buffer += text

    const frames: string[] = []
    let startIdx = 0

    while (startIdx < this.buffer.length) {
      const openIdx = this.buffer.indexOf("{", startIdx)
      if (openIdx === -1) {
        this.buffer = ""
        break
      }

      const closeIdx = this.buffer.indexOf("}", openIdx + 1)
      if (closeIdx === -1) {
        const partial = this.buffer.slice(openIdx)
        this.buffer = partial
        this.startMalformedTimer(partial)
        break
      }

      this.clearMalformedTimer()

      const content = this.buffer.slice(openIdx + 1, closeIdx)
      frames.push(content)

      const nextStart = closeIdx + 1
      if (nextStart >= this.buffer.length) {
        this.buffer = ""
        break
      }
      startIdx = nextStart
    }

    return frames
  }

  reset(): void {
    this.clearMalformedTimer()
    this.buffer = ""
  }

  private startMalformedTimer(partial: string): void {
    this.clearMalformedTimer()
    this.malformedTimer = setTimeout(() => {
      const error = new MalformedFrameError(partial)
      if (this.malformedHandler) {
        this.malformedHandler(error)
      }
      this.buffer = this.buffer.replace(partial, "")
      this.malformedTimer = null
    }, this.partialTimeoutMs)
  }

  private clearMalformedTimer(): void {
    if (this.malformedTimer !== null) {
      clearTimeout(this.malformedTimer)
      this.malformedTimer = null
    }
  }
}
