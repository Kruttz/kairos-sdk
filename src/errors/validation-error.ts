import { KairosError } from './base.js'
import type { ValidationIssue } from '../validation/types.js'
import type { AttemptMetadata } from '../telemetry/types.js'

export type { ValidationIssue }

export class ValidationError extends KairosError {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
    public readonly attemptMetadata?: AttemptMetadata[],
    public readonly warnedRules?: number[],
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}
