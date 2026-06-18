import Anthropic from '@anthropic-ai/sdk'
import type { N8nWorkflow, Tag } from './types/workflow.js'
import type { BuildResult, WorkflowListItem, ExecutionSummary, ExecutionDetail } from './types/result.js'
import type { ClientOptions, BuildOptions, DeleteOptions, ExecutionFilter } from './types/options.js'
import type { IWorkflowLibrary } from './library/types.js'
import { NullLibrary } from './library/null-library.js'
import { N8nApiClient } from './providers/n8n/api-client.js'
import { N8nFieldStripper } from './providers/n8n/stripper.js'
import { N8nProvider } from './providers/n8n/provider.js'
import { N8nValidator } from './validation/validator.js'
import { WorkflowDesigner } from './generation/designer.js'
import { TelemetryCollector } from './telemetry/collector.js'
import { nullLogger } from './utils/logger.js'
import type { ILogger } from './utils/logger.js'

const DEFAULT_MODEL = 'claude-sonnet-4-6'

export class Kairos {
  private readonly provider: N8nProvider
  private readonly designer: WorkflowDesigner
  private readonly validator: N8nValidator
  private readonly library: IWorkflowLibrary
  private readonly logger: ILogger
  private readonly telemetry: TelemetryCollector | null
  private readonly model: string

  constructor(options: ClientOptions) {
    const logger = options.logger ?? nullLogger
    this.model = options.model ?? DEFAULT_MODEL

    const anthropic = new Anthropic({ apiKey: options.anthropicApiKey })
    const apiClient = new N8nApiClient(options.n8nBaseUrl, options.n8nApiKey, logger)
    const stripper = new N8nFieldStripper()

    this.provider = new N8nProvider(apiClient, stripper)
    this.designer = new WorkflowDesigner(anthropic, this.model, logger)
    this.validator = new N8nValidator()
    this.library = options.library ?? new NullLibrary()
    this.logger = logger

    if (options.telemetry === true) {
      this.telemetry = new TelemetryCollector()
    } else if (typeof options.telemetry === 'string') {
      this.telemetry = new TelemetryCollector(options.telemetry)
    } else {
      this.telemetry = null
    }
  }

  async build(description: string, options?: BuildOptions): Promise<BuildResult> {
    this.logger.info('Kairos.build', { description, dryRun: options?.dryRun })
    const buildStart = Date.now()

    await this.telemetry?.emit('build_start', {
      description,
      model: this.model,
      dryRun: options?.dryRun ?? false,
    })

    await this.library.initialize()
    const matches = await this.library.search(description)

    const designResult = await this.designer.design(
      { description, ...(options?.name ? { name: options.name } : {}) },
      matches,
    )

    for (const meta of designResult.attemptMetadata) {
      await this.telemetry?.emit('generation_attempt', {
        description,
        attempt: meta.attempt,
        temperature: meta.temperature,
        durationMs: meta.durationMs,
        tokensInput: meta.tokensInput,
        tokensOutput: meta.tokensOutput,
        validationPassed: meta.validationPassed,
        issueCount: meta.issues.length,
        issues: meta.issues.map((i) => ({ rule: i.rule, message: i.message })),
      })
    }

    const workflow = options?.name
      ? { ...designResult.workflow, name: options.name }
      : designResult.workflow

    if (options?.dryRun) {
      const result: BuildResult = {
        workflowId: null,
        name: workflow.name,
        credentialsNeeded: designResult.credentialsNeeded,
        activationRequired: true,
        generationAttempts: designResult.attempts,
        dryRun: true,
      }

      const totalTokensInput = designResult.attemptMetadata.reduce((s, m) => s + m.tokensInput, 0)
      const totalTokensOutput = designResult.attemptMetadata.reduce((s, m) => s + m.tokensOutput, 0)

      await this.telemetry?.emit('build_complete', {
        description,
        success: true,
        totalAttempts: designResult.attempts,
        totalDurationMs: Date.now() - buildStart,
        totalTokensInput,
        totalTokensOutput,
        workflowName: workflow.name,
        workflowId: null,
        dryRun: true,
        credentialsNeeded: designResult.credentialsNeeded.length,
      })

      return result
    }

    const deployed = await this.provider.deploy(workflow)

    this.library.save(workflow, { description }).catch((err: unknown) => {
      this.logger.warn('Failed to save workflow to library (non-fatal)', { err: String(err) })
    })

    if (options?.activate) {
      await this.provider.activate(deployed.workflowId)
    }

    const result: BuildResult = {
      workflowId: deployed.workflowId,
      name: deployed.name,
      credentialsNeeded: designResult.credentialsNeeded,
      activationRequired: !options?.activate,
      generationAttempts: designResult.attempts,
      dryRun: false,
    }

    const totalTokensInput = designResult.attemptMetadata.reduce((s, m) => s + m.tokensInput, 0)
    const totalTokensOutput = designResult.attemptMetadata.reduce((s, m) => s + m.tokensOutput, 0)

    await this.telemetry?.emit('build_complete', {
      description,
      success: true,
      totalAttempts: designResult.attempts,
      totalDurationMs: Date.now() - buildStart,
      totalTokensInput,
      totalTokensOutput,
      workflowName: deployed.name,
      workflowId: deployed.workflowId,
      dryRun: false,
      credentialsNeeded: designResult.credentialsNeeded.length,
    })

    return result
  }

  async update(id: string, description: string): Promise<BuildResult> {
    this.logger.info('Kairos.update', { id, description })

    const matches = await this.library.search(description)
    const designResult = await this.designer.design({ description }, matches)
    const deployed = await this.provider.update(id, designResult.workflow)

    return {
      workflowId: deployed.workflowId,
      name: deployed.name,
      credentialsNeeded: designResult.credentialsNeeded,
      activationRequired: true,
      generationAttempts: designResult.attempts,
      dryRun: false,
    }
  }

  async get(id: string): Promise<N8nWorkflow> {
    return this.provider.get(id)
  }

  async list(): Promise<WorkflowListItem[]> {
    return this.provider.list()
  }

  async activate(id: string): Promise<void> {
    await this.provider.activate(id)
  }

  async deactivate(id: string): Promise<void> {
    await this.provider.deactivate(id)
  }

  async delete(id: string, options: DeleteOptions): Promise<void> {
    await this.provider.delete(id, options)
  }

  async executions(workflowId?: string, filter?: ExecutionFilter): Promise<ExecutionSummary[]> {
    return this.provider.executions(workflowId, filter)
  }

  async execution(id: string): Promise<ExecutionDetail> {
    return this.provider.execution(id)
  }

  async listTags(): Promise<Tag[]> {
    return this.provider.listTags()
  }

  async createTag(name: string): Promise<Tag> {
    return this.provider.createTag(name)
  }

  async tag(workflowId: string, tagIds: string[]): Promise<void> {
    await this.provider.tag(workflowId, tagIds)
  }

  async untag(workflowId: string, tagIds: string[]): Promise<void> {
    await this.provider.untag(workflowId, tagIds)
  }
}
