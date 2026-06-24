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

export interface BuildStartData {
  description: string
  model: string
  dryRun: boolean
}

export interface GenerationAttemptData {
  description: string
  attempt: number
  temperature: number
  durationMs: number
  tokensInput: number
  tokensOutput: number
  validationPassed: boolean
  issueCount: number
  issues: Array<{ rule: number; message: string; nodeId?: string | null }>
}

export interface BuildCompleteData {
  description: string
  success: boolean
  totalAttempts: number
  totalDurationMs: number
  totalTokensInput: number
  totalTokensOutput: number
  workflowName: string | null
  workflowId: string | null
  dryRun: boolean
  credentialsNeeded: number
  warnedRules: number[]
}
