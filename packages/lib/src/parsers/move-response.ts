export interface MoveResponse {
  serialNumber: string
  subCommand: number
  previousPosition: number
  previousInclination: number
  raw: string
}

export function moveResponseMatcher(frame: string): MoveResponse | null {
  if (frame.length < 25) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "7071") return null

  return {
    serialNumber: frame.slice(1, 7),
    subCommand: parseInt(frame.slice(17, 19), 16) & 0x03,
    previousPosition: Math.round(parseInt(frame.slice(21, 23), 16) / 2),
    previousInclination: parseInt(frame.slice(23, 25), 16) - 127,
    raw: frame,
  }
}
