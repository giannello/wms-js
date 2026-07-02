export class MalformedFrameError extends Error {
  readonly partial: string

  constructor(partial: string) {
    super(`Malformed frame: no closing brace within timeout`)
    this.name = "MalformedFrameError"
    this.partial = partial
  }
}
