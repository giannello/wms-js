export type AckMatcher = (frame: string) => string | null

export interface SessionOptions {
  ackMatcher: AckMatcher
  ackTimeoutMs?: number
  responseWindowMs?: number
}

export type SendResult =
  | { kind: "ack"; frame: string }
  | { kind: "fail" }
  | { kind: "timeout" }
