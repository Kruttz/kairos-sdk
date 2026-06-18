import { KairosError } from './base.js'

export class GenerationError extends KairosError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'GenerationError'
  }
}
