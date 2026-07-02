import { type SerialDriver } from "@warema/lib"
import { SerialPort } from "serialport"

export class NodeSerialDriver implements SerialDriver {
  private port: SerialPort | null = null
  private dataHandlers = new Set<(data: Uint8Array) => void>()
  private errorHandlers = new Set<(error: Error) => void>()
  private closeHandlers = new Set<() => void>()
  private _path = ""

  get path(): string {
    return this._path
  }

  async open(path: string): Promise<void> {
    this._path = path
    this.port = new SerialPort({
      path,
      baudRate: 128000,
      autoOpen: false,
    })

    await new Promise<void>((resolve, reject) => {
      if (!this.port) return reject(new Error("port not created"))

      this.port.on("open", () => resolve())
      this.port.on("error", (err) => reject(err))

      this.port.open((err) => {
        if (err) reject(err)
      })
    })

    this.port.on("data", (data: Buffer) => {
      for (const handler of this.dataHandlers) {
        handler(new Uint8Array(data))
      }
    })

    this.port.on("error", (err) => {
      for (const handler of this.errorHandlers) {
        handler(err)
      }
    })

    this.port.on("close", () => {
      for (const handler of this.closeHandlers) {
        handler()
      }
    })
  }

  async close(): Promise<void> {
    if (this.port) {
      this.port.removeAllListeners()
      await new Promise<void>((resolve) => {
        this.port!.close(() => resolve())
      })
      this.port = null
    }
    this.dataHandlers.clear()
    this.errorHandlers.clear()
    this.closeHandlers.clear()
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port) throw new Error("Serial port not open")
    await new Promise<void>((resolve, reject) => {
      this.port!.write(Buffer.from(data), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  onData(handler: (data: Uint8Array) => void): () => void {
    this.dataHandlers.add(handler)
    return () => { this.dataHandlers.delete(handler) }
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler)
    return () => { this.errorHandlers.delete(handler) }
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => { this.closeHandlers.delete(handler) }
  }
}
