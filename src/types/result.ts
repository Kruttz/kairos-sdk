export interface CredentialRequirement {
  service: string
  credentialType: string
  description: string
}

export interface BuildResult {
  workflowId: string | null
  name: string
  credentialsNeeded: CredentialRequirement[]
  activationRequired: boolean
  generationAttempts: number
  dryRun: boolean
}

export interface DeployResult {
  workflowId: string
  name: string
}

export interface WorkflowListItem {
  id: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
  tags?: Array<{ id: string; name: string }>
}

export interface ExecutionSummary {
  id: string
  workflowId: string
  status: 'success' | 'error' | 'waiting' | 'running' | 'canceled'
  startedAt: string
  stoppedAt?: string
  mode: string
}

export interface ExecutionDetail extends ExecutionSummary {
  data?: unknown
  workflowData?: unknown
}
