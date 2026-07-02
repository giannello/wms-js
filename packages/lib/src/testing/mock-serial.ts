import { type SerialDriver } from "../serial/driver.js"

export class MockSerialDriver implements SerialDriver {
  private dataHandlers = new Set<(data: Uint8Array) => void>()
  private errorHandlers = new Set<(error: Error) => void>()
  private closeHandlers = new Set<() => void>()
  private _isOpen = false
  private _writes: Uint8Array[] = []
  private _path = ""

  get isOpen(): boolean {
    return this._isOpen
  }

  get path(): string {
    return this._path
  }

  async open(path: string): Promise<void> {
    this._path = path
    this._isOpen = true
  }

  async close(): Promise<void> {
    this._isOpen = false
    this._writes = []
    this.dataHandlers.clear()
    this.errorHandlers.clear()
    this.closeHandlers.clear()
  }

  async write(data: Uint8Array): Promise<void> {
    this._writes.push(data)
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

  simulateData(data: Uint8Array): void {
    for (const handler of this.dataHandlers) {
      handler(data)
    }
  }

  simulateError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error)
    }
  }

  simulateClose(): void {
    for (const handler of this.closeHandlers) {
      handler()
    }
  }

  getWrites(): Uint8Array[] {
    return [...this._writes]
  }

  clearWrites(): void {
    this._writes = []
  }
}
