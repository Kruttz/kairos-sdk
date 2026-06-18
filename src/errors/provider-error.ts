import { KairosError } from './base.js'

export class ProviderError extends KairosError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ProviderError'
  }
}
