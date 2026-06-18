import type { N8nWorkflow, Tag } from '../types/workflow.js'
import type { DeployResult, WorkflowListItem, ExecutionSummary, ExecutionDetail } from '../types/result.js'
import type { DeleteOptions, ExecutionFilter } from '../types/options.js'

export interface IProvider {
  readonly platform: string
  deploy(workflow: N8nWorkflow): Promise<DeployResult>
  update(id: string, workflow: N8nWorkflow): Promise<DeployResult>
  get(id: string): Promise<N8nWorkflow>
  list(): Promise<WorkflowListItem[]>
  activate(id: string): Promise<void>
  deactivate(id: string): Promise<void>
  delete(id: string, options: DeleteOptions): Promise<void>
  executions(workflowId?: string, filter?: ExecutionFilter): Promise<ExecutionSummary[]>
  execution(id: string): Promise<ExecutionDetail>
  tag(workflowId: string, tagIds: string[]): Promise<void>
  untag(workflowId: string, tagIds: string[]): Promise<void>
  listTags(): Promise<Tag[]>
  createTag(name: string): Promise<Tag>
}
