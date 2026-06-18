export interface ValidationIssue {
  rule: number
  severity: 'error' | 'warn'
  message: string
  nodeId?: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
