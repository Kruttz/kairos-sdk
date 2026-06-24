import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PatternAnalyzer } from '../../src/telemetry/pattern-analyzer.js'
import { PromptBuilder } from '../../src/generation/prompt-builder.js'

describe('Pattern Pipeline Integration', () => {
  let parentDir: string
  let telemetryDir: string

  beforeEach(async () => {
    parentDir = join(tmpdir(), `kairos-integration-${Date.now()}`)
    telemetryDir = join(parentDir, 'telemetry')
    await mkdir(telemetryDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true })
  })

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10)
  }

  function makeEvent(eventType: string, sessionId: string, data: Record<string, unknown>): string {
    return JSON.stringify({ timestamp: new Date().toISOString(), sessionId, eventType, data })
  }

  it('analyzer writes patterns that PromptBuilder reads correctly', async () => {
    const events: string[] = []
    for (let i = 0; i < 4; i++) {
      events.push(
        makeEvent('build_start', `s${i}`, { description: 'test', dryRun: false, model: 'test' }),
        makeEvent('generation_attempt', `s${i}`, {
          validationPassed: false,
          issues: [{ rule: 17, message: 'credential "slackApi" missing' }],
          durationMs: 1000, tokensInput: 100, tokensOutput: 50,
        }),
      )
    }
    await writeFile(join(telemetryDir, `${todayStr()}.jsonl`), events.join('\n'))

    const patternsPath = join(parentDir, 'patterns.json')
    const analyzer = new PatternAnalyzer(telemetryDir)
    await analyzer.analyzeAndSave()

    const raw = await readFile(patternsPath, 'utf-8')
    const analysis = JSON.parse(raw)
    expect(analysis.topFailureRules.length).toBeGreaterThan(0)

    const pb = new PromptBuilder(patternsPath)
    const warnedRules = pb.getWarnedRules()
    expect(warnedRules).toContain(17)
  })

  it('warning effectiveness tracks warned-and-passed vs warned-and-failed', async () => {
    const events: string[] = []

    // Session 1: warned on rule 17, rule 17 still fails
    events.push(
      makeEvent('build_start', 'w1', { description: 'test', dryRun: false, model: 'test' }),
      makeEvent('generation_attempt', 'w1', {
        validationPassed: false,
        issues: [{ rule: 17, message: 'cred fail' }],
        durationMs: 1000, tokensInput: 100, tokensOutput: 50,
      }),
      makeEvent('build_complete', 'w1', {
        description: 'test', success: false, totalAttempts: 1,
        totalDurationMs: 1000, totalTokensInput: 100, totalTokensOutput: 50,
        workflowName: null, workflowId: null, dryRun: false,
        credentialsNeeded: 1, warnedRules: [17, 12],
      }),
    )

    // Session 2: warned on rule 17 and 12, both pass
    events.push(
      makeEvent('build_start', 'w2', { description: 'test', dryRun: false, model: 'test' }),
      makeEvent('generation_attempt', 'w2', {
        validationPassed: true, issues: [],
        durationMs: 1000, tokensInput: 100, tokensOutput: 50,
      }),
      makeEvent('build_complete', 'w2', {
        description: 'test', success: true, totalAttempts: 1,
        totalDurationMs: 1000, totalTokensInput: 100, totalTokensOutput: 50,
        workflowName: 'test', workflowId: '1', dryRun: false,
        credentialsNeeded: 0, warnedRules: [17, 12],
      }),
    )

    // Session 3: warned on rule 17 and 12, rule 17 fails
    events.push(
      makeEvent('build_start', 'w3', { description: 'test', dryRun: false, model: 'test' }),
      makeEvent('generation_attempt', 'w3', {
        validationPassed: false,
        issues: [{ rule: 17, message: 'cred fail' }],
        durationMs: 1000, tokensInput: 100, tokensOutput: 50,
      }),
      makeEvent('build_complete', 'w3', {
        description: 'test', success: false, totalAttempts: 1,
        totalDurationMs: 1000, totalTokensInput: 100, totalTokensOutput: 50,
        workflowName: null, workflowId: null, dryRun: false,
        credentialsNeeded: 1, warnedRules: [17, 12],
      }),
    )

    await writeFile(join(telemetryDir, `${todayStr()}.jsonl`), events.join('\n'))

    const analyzer = new PatternAnalyzer(telemetryDir)
    const result = await analyzer.analyze()

    expect(result.warningEffectiveness).toBeDefined()
    const rule17 = result.warningEffectiveness!.find(w => w.rule === 17)
    expect(rule17).toBeDefined()
    expect(rule17!.timesWarned).toBe(3)
    expect(rule17!.timesWarnedAndFailed).toBe(2)
    expect(rule17!.timesWarnedAndPassed).toBe(1)

    const rule12 = result.warningEffectiveness!.find(w => w.rule === 12)
    expect(rule12).toBeDefined()
    expect(rule12!.timesWarned).toBe(3)
    expect(rule12!.timesWarnedAndFailed).toBe(0)
    expect(rule12!.timesWarnedAndPassed).toBe(3)
  })

  it('detects regression across two analysis cycles', async () => {
    // Cycle 1: rule 17 fails heavily → becomes confirmed
    const cycle1Events: string[] = []
    for (let i = 0; i < 4; i++) {
      cycle1Events.push(
        makeEvent('build_start', `c1-s${i}`, { description: 'test', dryRun: false, model: 'test' }),
        makeEvent('generation_attempt', `c1-s${i}`, {
          validationPassed: false,
          issues: [{ rule: 17, message: 'cred fail' }],
          durationMs: 1000, tokensInput: 100, tokensOutput: 50,
        }),
      )
    }
    await writeFile(join(telemetryDir, `${todayStr()}.jsonl`), cycle1Events.join('\n'))

    const analyzer = new PatternAnalyzer(telemetryDir)
    const result1 = await analyzer.analyzeAndSave()
    const p1 = result1.topFailureRules.find(r => r.rule === 17)
    expect(p1).toBeDefined()
    expect(p1!.state).toBe('confirmed')

    // Cycle 2: rule 17 stops failing, many passing builds → becomes resolved
    await rm(join(telemetryDir, `${todayStr()}.jsonl`))
    const cycle2Events: string[] = []
    for (let i = 0; i < 6; i++) {
      cycle2Events.push(
        makeEvent('build_start', `c2-s${i}`, { description: 'test', dryRun: false, model: 'test' }),
        makeEvent('generation_attempt', `c2-s${i}`, {
          validationPassed: true, issues: [],
          durationMs: 1000, tokensInput: 100, tokensOutput: 50,
        }),
      )
    }
    await writeFile(join(telemetryDir, `${todayStr()}.jsonl`), cycle2Events.join('\n'))

    const result2 = await analyzer.analyzeAndSave()
    const p2 = result2.topFailureRules.find(r => r.rule === 17)
    expect(p2).toBeDefined()
    expect(p2!.state).toBe('resolved')

    // Cycle 3: rule 17 starts failing again → regressed
    await rm(join(telemetryDir, `${todayStr()}.jsonl`))
    const cycle3Events: string[] = []
    for (let i = 0; i < 3; i++) {
      cycle3Events.push(
        makeEvent('build_start', `c3-s${i}`, { description: 'test', dryRun: false, model: 'test' }),
        makeEvent('generation_attempt', `c3-s${i}`, {
          validationPassed: false,
          issues: [{ rule: 17, message: 'cred fail again' }],
          durationMs: 1000, tokensInput: 100, tokensOutput: 50,
        }),
      )
    }
    await writeFile(join(telemetryDir, `${todayStr()}.jsonl`), cycle3Events.join('\n'))

    const result3 = await analyzer.analyzeAndSave()
    const p3 = result3.topFailureRules.find(r => r.rule === 17)
    expect(p3).toBeDefined()
    expect(p3!.regressed).toBe(true)
  })
})
