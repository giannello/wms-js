export interface SerialDriver {
  open(path: string): Promise<void>
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  onData(handler: (data: Uint8Array) => void): () => void
  onError(handler: (error: Error) => void): () => void
  onClose(handler: () => void): () => void
}
