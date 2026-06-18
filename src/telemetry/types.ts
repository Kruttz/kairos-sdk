import type { ValidationIssue } from '../errors/validation-error.js'

export interface TelemetryEvent {
  timestamp: string
  sessionId: string
  eventType: 'build_start' | 'generation_attempt' | 'build_complete'
  data: Record<string, unknown>
}

export interface AttemptMetadata {
  attempt: number
  temperature: number
  durationMs: number
  tokensInput: number
  tokensOutput: number
  validationPassed: boolean
  issues: ValidationIssue[]
}
