import type { SerialDriver } from "@wms-js/lib"

export interface WMSerialPort {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}

export interface NavigatorWithSerial extends Navigator {
  serial: {
    requestPort(): Promise<WMSerialPort>
    getPorts(): Promise<WMSerialPort[]>
  }
}

export class WebSerialDriver implements SerialDriver {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private reading = false
  private dataHandlers = new Set<(data: Uint8Array) => void>()
  private errorHandlers = new Set<(error: Error) => void>()
  private closeHandlers = new Set<() => void>()

  constructor(private port: WMSerialPort) {}

  async open(_path: string): Promise<void> {
    await this.port.open({ baudRate: 128000 })
    this.startReading()
  }

  async close(): Promise<void> {
    this.reading = false
    try {
      this.reader?.cancel()
    } catch {
      // ignore
    }
    this.reader = null
    await this.port.close()
    for (const handler of this.closeHandlers) {
      handler()
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port.writable) {
      throw new Error("Serial port not writable")
    }
    const writer = this.port.writable.getWriter()
    await writer.write(data)
    writer.releaseLock()
  }

  onData(handler: (data: Uint8Array) => void): () => void {
    this.dataHandlers.add(handler)
    return () => this.dataHandlers.delete(handler)
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  private async startReading(): Promise<void> {
    this.reading = true
    while (this.reading) {
      try {
        const readable = this.port.readable
        if (!readable) {
          throw new Error("Serial port not readable")
        }
        this.reader = readable.getReader()
        while (true) {
          const { value, done } = await this.reader.read()
          if (done) break
          if (value) {
            for (const handler of this.dataHandlers) {
              handler(value)
            }
          }
        }
      } catch (err) {
        if (this.reading) {
          for (const handler of this.errorHandlers) {
            handler(err instanceof Error ? err : new Error(String(err)))
          }
        }
      } finally {
        try {
          this.reader?.releaseLock()
        } catch {
          // ignore
        }
        this.reader = null
      }
    }
  }
}
