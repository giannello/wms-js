const encoder = new TextEncoder()

export function serializeFrame(content: string): Uint8Array {
  return encoder.encode(`{${content}}`)
}
