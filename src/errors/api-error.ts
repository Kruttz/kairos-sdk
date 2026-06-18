import { KairosError } from './base.js'

export class ApiError extends KairosError {
  constructor(
    message: string,
    public readonly statusCode: number,
    cause?: unknown,
  ) {
    super(message, cause)
    this.name = 'ApiError'
  }
}
