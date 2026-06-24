export interface ValidationIssue {
  rule: number
  severity: 'error' | 'warn'
  message: string
  nodeId?: string
  nodeType?: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
