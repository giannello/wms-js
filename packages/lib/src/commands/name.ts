import { RadioController } from "../controller.js"
import { ackMatch } from "../command/ack-match.js"
import { deviceScanResponseMatcher } from "../parsers/device-scan-response.js"
import type { DeviceScanResponse } from "../parsers/device-scan-response.js"

export interface NetworkParams {
  receiveBroadcasts: boolean
  channel: number
  panId: string
}

export class Commands {
  constructor(private radio: RadioController) {}

  async getName(): Promise<string> {
    const session = this.radio.send("G", {
      ackMatcher: ackMatch.prefix("g"),
      responseWindowMs: 0,
    })

    const ack = await session.ack

    if (ack.kind === "timeout") {
      throw new Error("getName: ack timeout")
    }

    if (ack.kind === "fail") {
      throw new Error("getName: command rejected")
    }

    return ack.frame
  }

  async getVersion(): Promise<string> {
    const session = this.radio.send("V", {
      ackMatcher: ackMatch.prefix("v"),
      responseWindowMs: 0,
    })

    const ack = await session.ack

    if (ack.kind === "timeout") {
      throw new Error("getVersion: ack timeout")
    }

    if (ack.kind === "fail") {
      throw new Error("getVersion: command rejected")
    }

    return ack.frame.trim()
  }

  async setNetworkParameters(params: NetworkParams): Promise<void> {
    if (params.channel < 11 || params.channel > 26) {
      throw new Error("setNetworkParameters: invalid channel")
    }

    if (!/^[0-9A-Fa-f]{4}$/.test(params.panId)) {
      throw new Error("setNetworkParameters: invalid PAN ID")
    }

    const modeChar = params.receiveBroadcasts ? "%" : "#"
    const panId = params.panId.toUpperCase()
    const frame = `M ${modeChar} ${params.channel} ${panId}`

    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: 0,
    })

    const ack = await session.ack

    if (ack.kind === "fail") {
      throw new Error("setNetworkParameters: command rejected")
    }

    if (ack.kind === "timeout") {
      throw new Error("setNetworkParameters: ack timeout")
    }
  }

  async setEncryptionKey(key: string): Promise<void> {
    if (!/^[0-9A-Fa-f]{32}$/.test(key)) {
      throw new Error("setEncryptionKey: invalid key")
    }

    const frame = `K 401 ${key.toUpperCase()}`

    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: 0,
    })

    const ack = await session.ack

    if (ack.kind === "fail") {
      throw new Error("setEncryptionKey: command rejected")
    }

    if (ack.kind === "timeout") {
      throw new Error("setEncryptionKey: ack timeout")
    }
  }

  // NOTE: responseWindowMs consumes ALL serial frames during the scan window,
  // suppressing broadcast handlers (weather station, pairing, etc.). This is
  // acceptable because scanning is infrequent and short-lived (~3s).
  async scanNetwork(panId: string, timeoutMs = 3000): Promise<DeviceScanResponse[]> {
    if (!/^[0-9A-Fa-f]{4}$/.test(panId)) {
      throw new Error("scanNetwork: invalid PAN ID")
    }

    const responses: DeviceScanResponse[] = []
    const frame = `R04FFFFFF7020${panId.toUpperCase()}02`

    const session = this.radio.send(frame, {
      ackMatcher: ackMatch.exact("a"),
      responseWindowMs: timeoutMs,
    })

    session.onResponse((content) => {
      const parsed = deviceScanResponseMatcher(content)
      if (parsed) {
        responses.push(parsed)
      }
    })

    const ack = await session.ack

    if (ack.kind === "fail") {
      throw new Error("scanNetwork: command rejected")
    }

    if (ack.kind === "timeout") {
      throw new Error("scanNetwork: ack timeout")
    }

    await session.promise

    return responses
  }
}
