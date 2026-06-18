import { KairosError } from './base.js'

export interface ValidationIssue {
  rule: number
  severity: 'error' | 'warn'
  message: string
  nodeId?: string
}

export class ValidationError extends KairosError {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}
