export class KairosError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'KairosError'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}
