export interface WaveResponse {
  serialNumber: string
  code: string
  raw: string
}

export function waveResponseMatcher(frame: string): WaveResponse | null {
  if (frame.length < 15) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "50AC") return null

  return {
    serialNumber: frame.slice(1, 7),
    code: frame.slice(11, 15),
    raw: frame,
  }
}
