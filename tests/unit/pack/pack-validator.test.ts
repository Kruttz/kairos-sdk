import { describe, it, expect } from 'vitest'
import { validatePack } from '../../../src/pack/pack-validator.js'
import type { WorkflowPackResult } from '../../../src/pack/pack-builder.js'

function makeWorkflow(overrides: Partial<WorkflowPackResult['workflows'][0]> = {}): WorkflowPackResult['workflows'][0] {
  return {
    name: 'Test Workflow',
    purpose: 'Test',
    workflowId: 'wf-1',
    deployed: true,
    generationAttempts: 1,
    credentialsNeeded: [],
    ...overrides,
  }
}

function makePack(overrides: Partial<WorkflowPackResult> = {}): WorkflowPackResult {
  return {
    businessContext: 'Test',
    packName: 'test',
    status: 'ready_for_activation',
    workflows: [makeWorkflow()],
    allCredentials: [],
    sheetsColumns: [],
    assumptions: [],
    testChecklist: [],
    builtAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('validatePack()', () => {
  it('returns no issues for a clean pack', () => {
    const issues = validatePack(makePack())
    expect(issues).toHaveLength(0)
  })

  describe('duplicate names', () => {
    it('flags duplicate workflow names as error', () => {
      const pack = makePack({
        workflows: [
          makeWorkflow({ name: 'Send Newsletter' }),
          makeWorkflow({ name: 'Send Newsletter', workflowId: 'wf-2' }),
        ],
      })
      const issues = validatePack(pack)
      expect(issues).toHaveLength(1)
      expect(issues[0]!.type).toBe('duplicate_name')
      expect(issues[0]!.severity).toBe('error')
      expect(issues[0]!.message).toContain('Send Newsletter')
    })

    it('allows unique workflow names', () => {
      const pack = makePack({
        workflows: [makeWorkflow({ name: 'A' }), makeWorkflow({ name: 'B' })],
      })
      const issues = validatePack(pack)
      expect(issues.filter(i => i.type === 'duplicate_name')).toHaveLength(0)
    })

    it('includes duplicate name in workflows array', () => {
      const pack = makePack({
        workflows: [makeWorkflow({ name: 'Dupe' }), makeWorkflow({ name: 'Dupe' })],
      })
      const issues = validatePack(pack)
      expect(issues[0]!.workflows).toContain('Dupe')
    })
  })

  describe('blocking assumptions', () => {
    it('flags blocking assumptions as error', () => {
      const pack = makePack({
        assumptions: [{ type: 'blocking', text: 'Google Sheet ID missing' }],
      })
      const issues = validatePack(pack)
      expect(issues.some(i => i.type === 'blocking_assumption')).toBe(true)
      const issue = issues.find(i => i.type === 'blocking_assumption')!
      expect(issue.severity).toBe('error')
      expect(issue.message).toContain('Google Sheet ID missing')
    })

    it('does not flag safe assumptions', () => {
      const pack = makePack({
        assumptions: [{ type: 'safe', text: 'Schedule is Monday 9 AM' }],
      })
      const issues = validatePack(pack)
      expect(issues.filter(i => i.type === 'blocking_assumption')).toHaveLength(0)
    })

    it('does not flag needs_confirmation assumptions', () => {
      const pack = makePack({
        assumptions: [{ type: 'needs_confirmation', text: 'Confirm email tone' }],
      })
      const issues = validatePack(pack)
      expect(issues.filter(i => i.type === 'blocking_assumption')).toHaveLength(0)
    })

    it('mentions count of blocking assumptions in message', () => {
      const pack = makePack({
        assumptions: [
          { type: 'blocking', text: 'Sheet ID missing' },
          { type: 'blocking', text: 'OAuth token missing' },
        ],
      })
      const issues = validatePack(pack)
      const issue = issues.find(i => i.type === 'blocking_assumption')!
      expect(issue.message).toContain('2 blocking')
    })
  })

  describe('unsafe activation (failed workflows)', () => {
    it('flags failed workflows as error', () => {
      const pack = makePack({
        workflows: [makeWorkflow({ deployed: false, workflowId: null, error: 'n8n refused' })],
      })
      const issues = validatePack(pack)
      expect(issues.some(i => i.type === 'unsafe_activation')).toBe(true)
      const issue = issues.find(i => i.type === 'unsafe_activation')!
      expect(issue.severity).toBe('error')
      expect(issue.message).toContain('n8n refused')
    })

    it('includes workflow name in unsafe_activation workflows list', () => {
      const pack = makePack({
        workflows: [makeWorkflow({ name: 'Broken Workflow', error: 'fail' })],
      })
      const issues = validatePack(pack)
      const issue = issues.find(i => i.type === 'unsafe_activation')!
      expect(issue.workflows).toContain('Broken Workflow')
    })

    it('does not flag deployed workflows without error', () => {
      const pack = makePack({
        workflows: [makeWorkflow({ deployed: true, error: undefined })],
      })
      const issues = validatePack(pack)
      expect(issues.filter(i => i.type === 'unsafe_activation')).toHaveLength(0)
    })
  })

  describe('combined issues', () => {
    it('reports multiple issue types in one call', () => {
      const pack = makePack({
        workflows: [
          makeWorkflow({ name: 'Dup' }),
          makeWorkflow({ name: 'Dup' }),
          makeWorkflow({ name: 'Failed', deployed: false, workflowId: null, error: 'failed' }),
        ],
        assumptions: [{ type: 'blocking', text: 'Missing data' }],
      })
      const issues = validatePack(pack)
      const types = issues.map(i => i.type)
      expect(types).toContain('duplicate_name')
      expect(types).toContain('blocking_assumption')
      expect(types).toContain('unsafe_activation')
    })
  })
})
