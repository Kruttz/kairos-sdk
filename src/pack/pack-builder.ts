import Anthropic from '@anthropic-ai/sdk'
import type { Kairos } from '../client.js'
import type { CredentialRequirement } from '../types/result.js'

export interface WorkflowPlan {
  name: string
  description: string
  purpose: string
}

export interface PackPlan {
  businessContext: string
  workflows: WorkflowPlan[]
  assumptions: string[]
  openQuestions: string[]
  sheetsColumns: Array<{ sheet: string; columns: string[] }>
  testChecklist: Array<{ workflow: string; steps: string[] }>
}

export interface PackWorkflowResult {
  name: string
  purpose: string
  workflowId: string | null
  deployed: boolean
  generationAttempts: number
  credentialsNeeded: CredentialRequirement[]
  error?: string
}

export interface WorkflowPackResult {
  businessContext: string
  packName: string
  workflows: PackWorkflowResult[]
  allCredentials: Array<{ service: string; credentialType: string }>
  sheetsColumns: Array<{ sheet: string; columns: string[] }>
  assumptions: string[]
  openQuestions: string[]
  testChecklist: Array<{ workflow: string; steps: string[] }>
  builtAt: string
}

const PLAN_PROMPT = `You are planning an n8n workflow automation pack for a business.

Business context: {CONTEXT}

Generate a list of 4-8 n8n workflows that would meaningfully automate this business's operations. Focus on workflows that save time on repetitive tasks, improve customer communication, prevent things falling through the cracks, and are realistic to implement with n8n nodes.

For each workflow, write a detailed build description (2-4 sentences) suitable for passing directly to an n8n workflow generator. Be specific: name the trigger type, data sources (Google Sheets columns if applicable), actions, and outputs.

Return ONLY valid JSON with no markdown or extra text:
{
  "workflows": [
    {
      "name": "Short descriptive name",
      "description": "Detailed generator-ready description specifying trigger, data sources, actions, outputs",
      "purpose": "One sentence explaining the business value"
    }
  ],
  "assumptions": ["Assumption made about the business or its systems"],
  "openQuestions": ["Question needing a human answer before these workflows go live"],
  "sheetsColumns": [
    { "sheet": "Sheet name", "columns": ["col1", "col2"] }
  ],
  "testChecklist": [
    { "workflow": "Workflow name", "steps": ["How to manually test this workflow"] }
  ]
}`

export class PackBuilder {
  private client: Anthropic
  private kairos: Kairos
  private model: string

  constructor(options: { anthropicApiKey: string; kairos: Kairos; model?: string }) {
    this.client = new Anthropic({ apiKey: options.anthropicApiKey })
    this.kairos = options.kairos
    this.model = options.model ?? 'claude-sonnet-4-6'
  }

  async plan(businessContext: string): Promise<PackPlan> {
    const prompt = PLAN_PROMPT.replace('{CONTEXT}', businessContext)
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as Omit<PackPlan, 'businessContext'>

    return {
      businessContext,
      workflows: parsed.workflows ?? [],
      assumptions: parsed.assumptions ?? [],
      openQuestions: parsed.openQuestions ?? [],
      sheetsColumns: parsed.sheetsColumns ?? [],
      testChecklist: parsed.testChecklist ?? [],
    }
  }

  async build(
    plan: PackPlan,
    options: {
      dryRun?: boolean
      activate?: boolean
      onProgress?: (workflow: WorkflowPlan, index: number, total: number) => void
    } = {}
  ): Promise<WorkflowPackResult> {
    const results: PackWorkflowResult[] = []
    const credentialMap = new Map<string, { service: string; credentialType: string }>()

    for (let i = 0; i < plan.workflows.length; i++) {
      const wf = plan.workflows[i]!
      options.onProgress?.(wf, i, plan.workflows.length)

      try {
        const result = await this.kairos.build(wf.description, {
          name: wf.name,
          dryRun: options.dryRun ?? false,
          activate: options.activate ?? false,
        })

        for (const cred of result.credentialsNeeded) {
          credentialMap.set(cred.service, { service: cred.service, credentialType: cred.credentialType })
        }

        results.push({
          name: wf.name,
          purpose: wf.purpose,
          workflowId: result.workflowId,
          deployed: !result.dryRun,
          generationAttempts: result.generationAttempts,
          credentialsNeeded: result.credentialsNeeded,
        })
      } catch (err) {
        results.push({
          name: wf.name,
          purpose: wf.purpose,
          workflowId: null,
          deployed: false,
          generationAttempts: 0,
          credentialsNeeded: [],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const packName = plan.businessContext
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    return {
      businessContext: plan.businessContext,
      packName,
      workflows: results,
      allCredentials: Array.from(credentialMap.values()),
      sheetsColumns: plan.sheetsColumns,
      assumptions: plan.assumptions,
      openQuestions: plan.openQuestions,
      testChecklist: plan.testChecklist,
      builtAt: new Date().toISOString(),
    }
  }
}
