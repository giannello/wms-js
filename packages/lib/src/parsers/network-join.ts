export interface NetworkJoinMessage {
  serialNumber: string
  panId: string
  key: string
  channel: number
  raw: string
}

export function networkJoinMatcher(frame: string): NetworkJoinMessage | null {
  if (frame.length < 51) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "5018") return null
  if (frame.slice(47, 49) !== "FF") return null

  const channelHex = frame.slice(49, 51)
  const channel = Number.parseInt(channelHex, 16)

  if (Number.isNaN(channel) || channel < 11 || channel > 26) return null

  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    key: decodeKey(frame.slice(15, 47)),
    channel,
    raw: frame,
  }
}

function decodeKey(hex: string): string {
  let out = ""
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    out += hex.slice(i, i + 2)
  }
  return out
}
