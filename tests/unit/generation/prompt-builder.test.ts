import { describe, it, expect } from 'vitest'
import { PromptBuilder } from '../../../src/generation/prompt-builder.js'
import { SYSTEM_PROMPT_V1 } from '../../../src/generation/prompts/v1.js'

describe('PromptBuilder', () => {
  const builder = new PromptBuilder()

  it('returns scratch mode when no matches', () => {
    const prompt = builder.build({ description: 'send a Slack message' }, [])
    expect(prompt.mode).toBe('scratch')
  })

  it('system prompt block is first and has cache_control ephemeral', () => {
    const prompt = builder.build({ description: 'test' }, [])
    expect(prompt.system.length).toBeGreaterThanOrEqual(1)
    const first = prompt.system[0]!
    expect(first.type).toBe('text')
    expect(first.text).toBe(SYSTEM_PROMPT_V1)
    expect(first.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('user message includes the description', () => {
    const prompt = builder.build({ description: 'send daily Slack digest at 9am' }, [])
    expect(prompt.userMessage).toContain('send daily Slack digest at 9am')
  })

  it('user message includes custom name when provided', () => {
    const prompt = builder.build({ description: 'check API health', name: 'Health Monitor' }, [])
    expect(prompt.userMessage).toContain('Health Monitor')
  })

  it('correction message includes issue list and attempt number', () => {
    const issues = ['- [Rule 12] Forbidden field "id" present', '- [Rule 14] No trigger node']
    const msg = builder.buildCorrectionMessage({ description: 'test workflow' }, [], issues, 1)
    expect(msg).toContain('attempt 1')
    expect(msg).toContain('[Rule 12]')
    expect(msg).toContain('[Rule 14]')
    expect(msg).toContain('Fix ALL')
  })

  it('system prompt contains key sections', () => {
    expect(SYSTEM_PROMPT_V1).toContain('generate_workflow')
    expect(SYSTEM_PROMPT_V1).toContain('Forbidden fields')
    expect(SYSTEM_PROMPT_V1).toContain('ai_languageModel')
    expect(SYSTEM_PROMPT_V1).toContain('SUB-NODE is the SOURCE')
    expect(SYSTEM_PROMPT_V1).toContain('executionOrder')
  })
})
