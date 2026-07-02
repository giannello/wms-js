import { type AckMatcher } from "./types.js"

export const ackMatch = {
  exact(type: string): AckMatcher {
    return (frame: string) => (frame === type ? "" : null)
  },

  prefix(prefix: string): AckMatcher {
    return (frame: string) => (frame.startsWith(prefix) ? frame.slice(prefix.length) : null)
  },
}
