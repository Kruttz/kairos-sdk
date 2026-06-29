import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PackBuilder } from '../../../src/pack/pack-builder.js'
import type { Kairos } from '../../../src/client.js'

const MOCK_PLAN_RESPONSE = {
  workflows: [
    {
      name: 'Weekly Newsletter',
      description: 'Send a weekly newsletter via Gmail using a Schedule trigger every Monday at 9am.',
      purpose: 'Keep customers engaged with regular updates.',
    },
    {
      name: 'New Customer Welcome',
      description: 'Webhook-triggered workflow that sends a welcome email when a new customer is added.',
      purpose: 'Onboard new customers automatically.',
    },
  ],
  assumptions: ['Customer emails are stored in Google Sheets', 'Gmail is the sending platform'],
  openQuestions: ['What should the newsletter tone be?', 'Who approves content before sending?'],
  sheetsColumns: [{ sheet: 'Customers', columns: ['name', 'email'] }],
  testChecklist: [
    { workflow: 'Weekly Newsletter', steps: ['Trigger manually and check inbox'] },
    { workflow: 'New Customer Welcome', steps: ['POST to webhook with test data'] },
  ],
}

function makeMockAnthropic(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

function makeMockKairos(overrides: Partial<{ workflowId: string; generationAttempts: number }> = {}): Kairos {
  return {
    build: vi.fn().mockResolvedValue({
      workflowId: overrides.workflowId ?? 'wf-123',
      name: 'Test Workflow',
      workflow: {},
      credentialsNeeded: [{ service: 'Gmail', credentialType: 'gmailOAuth2', description: 'Gmail OAuth2' }],
      activationRequired: false,
      generationAttempts: overrides.generationAttempts ?? 1,
      dryRun: false,
    }),
    drain: vi.fn().mockResolvedValue(undefined),
  } as unknown as Kairos
}

describe('PackBuilder', () => {
  let builder: PackBuilder

  beforeEach(() => {
    builder = new PackBuilder({
      anthropicApiKey: 'sk-ant-test',
      kairos: makeMockKairos(),
    })
    // Replace internal Anthropic client with mock
    ;(builder as unknown as Record<string, unknown>)['client'] = makeMockAnthropic(
      JSON.stringify(MOCK_PLAN_RESPONSE)
    )
  })

  describe('plan()', () => {
    it('returns a structured plan from LLM response', async () => {
      const plan = await builder.plan('Test DME business')
      expect(plan.businessContext).toBe('Test DME business')
      expect(plan.workflows).toHaveLength(2)
      expect(plan.workflows[0]!.name).toBe('Weekly Newsletter')
      expect(plan.assumptions).toHaveLength(2)
      expect(plan.openQuestions).toHaveLength(2)
      expect(plan.sheetsColumns).toHaveLength(1)
      expect(plan.testChecklist).toHaveLength(2)
    })

    it('strips markdown code fences from LLM response', async () => {
      ;(builder as unknown as Record<string, unknown>)['client'] = makeMockAnthropic(
        '```json\n' + JSON.stringify(MOCK_PLAN_RESPONSE) + '\n```'
      )
      const plan = await builder.plan('Test business')
      expect(plan.workflows).toHaveLength(2)
    })

    it('handles missing optional fields gracefully', async () => {
      const minimal = { workflows: [{ name: 'A', description: 'B', purpose: 'C' }] }
      ;(builder as unknown as Record<string, unknown>)['client'] = makeMockAnthropic(JSON.stringify(minimal))
      const plan = await builder.plan('Minimal business')
      expect(plan.assumptions).toEqual([])
      expect(plan.openQuestions).toEqual([])
      expect(plan.sheetsColumns).toEqual([])
      expect(plan.testChecklist).toEqual([])
    })
  })

  describe('build()', () => {
    it('builds all workflows and returns aggregated result', async () => {
      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test DME' }
      const result = await builder.build(plan)

      expect(result.workflows).toHaveLength(2)
      expect(result.workflows[0]!.deployed).toBe(true)
      expect(result.workflows[0]!.workflowId).toBe('wf-123')
      expect(result.businessContext).toBe('Test DME')
    })

    it('deduplicates credentials across workflows', async () => {
      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test DME' }
      const result = await builder.build(plan)
      // Both workflows return Gmail — should appear once
      expect(result.allCredentials).toHaveLength(1)
      expect(result.allCredentials[0]!.service).toBe('Gmail')
    })

    it('records error without crashing when a workflow fails', async () => {
      const failingKairos = {
        build: vi.fn()
          .mockResolvedValueOnce({
            workflowId: 'wf-ok',
            name: 'OK',
            workflow: {},
            credentialsNeeded: [],
            activationRequired: false,
            generationAttempts: 1,
            dryRun: false,
          })
          .mockRejectedValueOnce(new Error('n8n connection refused')),
        drain: vi.fn().mockResolvedValue(undefined),
      } as unknown as Kairos

      builder = new PackBuilder({ anthropicApiKey: 'sk-ant-test', kairos: failingKairos })
      ;(builder as unknown as Record<string, unknown>)['client'] = makeMockAnthropic(
        JSON.stringify(MOCK_PLAN_RESPONSE)
      )

      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test DME' }
      const result = await builder.build(plan)

      expect(result.workflows[0]!.deployed).toBe(true)
      expect(result.workflows[1]!.deployed).toBe(false)
      expect(result.workflows[1]!.error).toBe('n8n connection refused')
    })

    it('generates a slug pack name from business context', async () => {
      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Empire Homecare DME Operations' }
      const result = await builder.build(plan)
      expect(result.packName).toBe('empire-homecare-dme-operations')
    })

    it('calls onProgress for each workflow', async () => {
      const progress = vi.fn()
      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test' }
      await builder.build(plan, { onProgress: progress })
      expect(progress).toHaveBeenCalledTimes(2)
      expect(progress).toHaveBeenCalledWith(plan.workflows[0], 0, 2)
      expect(progress).toHaveBeenCalledWith(plan.workflows[1], 1, 2)
    })

    it('passes dryRun and activate options to each kairos.build call', async () => {
      const mockKairos = makeMockKairos()
      builder = new PackBuilder({ anthropicApiKey: 'sk-ant-test', kairos: mockKairos })
      ;(builder as unknown as Record<string, unknown>)['client'] = makeMockAnthropic(
        JSON.stringify(MOCK_PLAN_RESPONSE)
      )

      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test' }
      await builder.build(plan, { dryRun: true, activate: false })

      expect(mockKairos.build).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ dryRun: true, activate: false })
      )
    })

    it('includes builtAt timestamp in result', async () => {
      const before = Date.now()
      const plan = { ...MOCK_PLAN_RESPONSE, businessContext: 'Test' }
      const result = await builder.build(plan)
      const after = Date.now()
      const builtAt = new Date(result.builtAt).getTime()
      expect(builtAt).toBeGreaterThanOrEqual(before)
      expect(builtAt).toBeLessThanOrEqual(after)
    })
  })
})
