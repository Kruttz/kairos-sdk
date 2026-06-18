import { KairosError } from './base.js'

export class ResponseParseError extends KairosError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ResponseParseError'
  }
}
