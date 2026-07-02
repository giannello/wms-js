export interface WaveRequest {
  serialNumber: string
  raw: string
}

export function waveRequestMatcher(frame: string): WaveRequest | null {
  if (frame.length < 11) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7050") return null

  return {
    serialNumber: frame.slice(1, 7),
    raw: frame,
  }
}
