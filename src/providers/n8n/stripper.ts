import type { N8nWorkflow } from '../../types/workflow.js'
import { FORBIDDEN_ON_CREATE, FORBIDDEN_ON_UPDATE } from './types.js'

export class N8nFieldStripper {
  stripForCreate(workflow: N8nWorkflow): N8nWorkflow {
    return this.strip(workflow, FORBIDDEN_ON_CREATE as readonly string[])
  }

  stripForUpdate(workflow: N8nWorkflow): N8nWorkflow {
    return this.strip(workflow, FORBIDDEN_ON_UPDATE as readonly string[])
  }

  private strip(workflow: N8nWorkflow, forbidden: readonly string[]): N8nWorkflow {
    const result = { ...workflow } as unknown as Record<string, unknown>
    for (const field of forbidden) {
      delete result[field]
    }
    return result as unknown as N8nWorkflow
  }
}
