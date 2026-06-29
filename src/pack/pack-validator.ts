import type { WorkflowPackResult } from './pack-builder.js'

export interface PackValidationIssue {
  type: 'duplicate_name' | 'blocking_assumption' | 'unsafe_activation' | 'schedule_conflict'
  severity: 'error' | 'warning'
  message: string
  workflows?: string[]
}

export function validatePack(pack: WorkflowPackResult): PackValidationIssue[] {
  const issues: PackValidationIssue[] = []

  // Duplicate workflow names
  const names = pack.workflows.map(w => w.name)
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name)
    seen.add(name)
  }
  if (duplicates.size > 0) {
    issues.push({
      type: 'duplicate_name',
      severity: 'error',
      message: `Duplicate workflow names: ${[...duplicates].join(', ')} — n8n may overwrite existing workflows on deploy`,
      workflows: [...duplicates],
    })
  }

  // Unresolved blocking assumptions
  const blocking = pack.assumptions.filter(a => a.type === 'blocking')
  if (blocking.length > 0) {
    const plural = blocking.length === 1 ? 'assumption' : 'assumptions'
    issues.push({
      type: 'blocking_assumption',
      severity: 'error',
      message: `${blocking.length} blocking ${plural} must be resolved before activation:\n  ${blocking.map(a => `• ${a.text}`).join('\n  ')}`,
    })
  }

  // Workflows that failed to deploy
  const failed = pack.workflows.filter(w => w.error)
  for (const wf of failed) {
    issues.push({
      type: 'unsafe_activation',
      severity: 'error',
      message: `Workflow "${wf.name}" failed to deploy: ${wf.error ?? 'unknown error'}`,
      workflows: [wf.name],
    })
  }

  return issues
}
