import type { WorkflowMatch } from '../library/types.js'
import type { N8nWorkflow } from '../types/workflow.js'
import type { CredentialRequirement } from '../types/result.js'
import type { AttemptMetadata } from '../telemetry/types.js'

export interface DesignRequest {
  description: string
  name?: string
}

export interface DesignResult {
  workflow: N8nWorkflow
  credentialsNeeded: CredentialRequirement[]
  attempts: number
  attemptMetadata: AttemptMetadata[]
  warnedRules: number[]
}

export interface SystemPromptBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface BuiltPrompt {
  system: SystemPromptBlock[]
  userMessage: string
  mode: 'direct' | 'reference' | 'scratch'
  matches: WorkflowMatch[]
}
