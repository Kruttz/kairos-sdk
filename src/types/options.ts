import type { ILogger } from '../utils/logger.js'
import type { IWorkflowLibrary } from '../library/types.js'

export interface ClientOptions {
  anthropicApiKey: string
  n8nBaseUrl?: string
  n8nApiKey?: string
  model?: string
  logger?: ILogger
  library?: IWorkflowLibrary
  telemetry?: boolean | string
}

export interface BuildOptions {
  dryRun?: boolean
  activate?: boolean
  name?: string
}

export interface DeleteOptions {
  confirm: true
}

export interface ExecutionFilter {
  status?: 'success' | 'error' | 'waiting' | 'running'
  limit?: number
  cursor?: string
}
