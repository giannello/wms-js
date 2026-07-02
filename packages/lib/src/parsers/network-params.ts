export interface NetworkParamsMessage {
  serialNumber: string
  panId: string
  channel: number
  raw: string
}

export function networkParamsMatcher(frame: string): NetworkParamsMessage | null {
  if (frame.length < 21) return null
  if (frame[0] !== "r") return null
  if (frame.slice(7, 11) !== "5060") return null

  const channelHex = frame.slice(17, 19)
  const channel = Number.parseInt(channelHex, 16)

  if (Number.isNaN(channel) || channel < 11 || channel > 26) return null

  return {
    serialNumber: frame.slice(1, 7),
    panId: frame.slice(11, 15),
    channel,
    raw: frame,
  }
}
