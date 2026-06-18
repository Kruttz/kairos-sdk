import type { N8nWorkflow } from '../types/workflow.js'

export interface WorkflowMetadataInput {
  description: string
  tags?: string[]
  platform?: string
}

export interface StoredWorkflow {
  id: string
  workflow: N8nWorkflow
  description: string
  tags: string[]
  platform: string
  deployCount: number
  createdAt: string
  lastDeployedAt?: string
}

export interface WorkflowMatch {
  workflow: StoredWorkflow
  score: number
  mode: 'direct' | 'reference' | 'scratch'
}

export interface SearchOptions {
  limit?: number
  platform?: string
}

export interface LibraryFilters {
  platform?: string
  tags?: string[]
}

export interface IWorkflowLibrary {
  initialize(): Promise<void>
  search(description: string, options?: SearchOptions): Promise<WorkflowMatch[]>
  save(workflow: N8nWorkflow, metadata: WorkflowMetadataInput): Promise<string>
  recordDeployment(id: string): Promise<void>
  get(id: string): Promise<StoredWorkflow | null>
  list(filters?: LibraryFilters): Promise<StoredWorkflow[]>
}
