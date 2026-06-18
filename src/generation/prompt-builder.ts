import type { WorkflowMatch } from '../library/types.js'
import type { DesignRequest, BuiltPrompt, SystemPromptBlock } from './types.js'
import { SYSTEM_PROMPT_V1 } from './prompts/v1.js'

export class PromptBuilder {
  build(request: DesignRequest, matches: WorkflowMatch[]): BuiltPrompt {
    const mode = this.resolveMode(matches)
    const system = this.buildSystem(matches, mode)
    const userMessage = this.buildUserMessage(request, matches, mode)
    return { system, userMessage, mode, matches }
  }

  buildCorrectionMessage(
    request: DesignRequest,
    matches: WorkflowMatch[],
    allIssues: string[],
    attempt: number,
  ): string {
    const base = this.buildUserMessage(request, matches, this.resolveMode(matches))
    return `${base}

IMPORTANT: A previous generation attempt (attempt ${attempt}) failed validation with these issues:
${allIssues.join('\n')}

Fix ALL of the above issues in your new response. Do not repeat any of these mistakes.`
  }

  private resolveMode(matches: WorkflowMatch[]): 'direct' | 'reference' | 'scratch' {
    if (matches.length === 0) return 'scratch'
    const top = matches[0]
    if (!top) return 'scratch'
    if (top.score >= 0.92) return 'direct'
    if (top.score >= 0.72) return 'reference'
    return 'scratch'
  }

  private buildSystem(matches: WorkflowMatch[], mode: 'direct' | 'reference' | 'scratch'): SystemPromptBlock[] {
    const blocks: SystemPromptBlock[] = [
      {
        type: 'text',
        text: SYSTEM_PROMPT_V1,
        cache_control: { type: 'ephemeral' },
      },
    ]

    if (mode === 'reference' && matches.length > 0) {
      const refText = matches
        .slice(0, 3)
        .map((m) => {
          const nodes = m.workflow.workflow.nodes
            .map((n) => `  - ${n.name} (${n.type} v${n.typeVersion})`)
            .join('\n')
          return `Reference workflow: "${m.workflow.description}" (similarity: ${m.score.toFixed(2)})\nNodes:\n${nodes}`
        })
        .join('\n\n')

      blocks.push({
        type: 'text',
        text: `## Similar Workflows From Library (for reference only — adapt, do not copy verbatim)\n\n${refText}`,
      })
    }

    if (mode === 'direct' && matches[0]) {
      const match = matches[0]
      blocks.push({
        type: 'text',
        text: `## Closely Matched Workflow (score: ${match.score.toFixed(2)}) — adapt this structure:\n\n${JSON.stringify(match.workflow.workflow, null, 2)}`,
      })
    }

    return blocks
  }

  private buildUserMessage(request: DesignRequest, _matches: WorkflowMatch[], _mode: string): string {
    const namePart = request.name ? `\nWorkflow name: "${request.name}"` : ''
    return `Build a workflow that: ${request.description}${namePart}`
  }
}
