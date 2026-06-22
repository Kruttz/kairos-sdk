import type { ValidationIssue } from '../errors/validation-error.js'

export interface TelemetryEvent {
  schemaVersion: number
  timestamp: string
  sessionId: string
  eventType: 'build_start' | 'generation_attempt' | 'build_complete'
  data: Record<string, unknown>
}

export const TELEMETRY_SCHEMA_VERSION = 2

export interface AttemptMetadata {
  attempt: number
  temperature: number
  durationMs: number
  tokensInput: number
  tokensOutput: number
  validationPassed: boolean
  issues: ValidationIssue[]
}
