import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTelemetryEvents } from '../../../src/telemetry/event-reader.js'

describe('readTelemetryEvents', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `kairos-event-reader-${Date.now()}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function todayStr(): string {
    return new Date().toISOString().slice(0, 10)
  }

  it('reads events from JSONL files within date range', async () => {
    const event = JSON.stringify({ eventType: 'build_start', sessionId: 's1', data: { test: true } })
    await writeFile(join(dir, `${todayStr()}.jsonl`), event)

    const events = await readTelemetryEvents(dir, 30)

    expect(events.length).toBe(1)
    expect(events[0]!.eventType).toBe('build_start')
    expect(events[0]!.fileDate).toBe(todayStr())
  })

  it('returns empty array for nonexistent directory', async () => {
    const events = await readTelemetryEvents(join(dir, 'nonexistent'), 30)
    expect(events).toEqual([])
  })

  it('skips non-JSONL files', async () => {
    await writeFile(join(dir, 'notes.txt'), 'not telemetry')
    const event = JSON.stringify({ eventType: 'test', sessionId: 's1', data: {} })
    await writeFile(join(dir, `${todayStr()}.jsonl`), event)

    const events = await readTelemetryEvents(dir, 30)
    expect(events.length).toBe(1)
  })

  it('excludes future-dated files', async () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const futureDate = tomorrow.toISOString().slice(0, 10)

    await writeFile(join(dir, `${futureDate}.jsonl`), JSON.stringify({ eventType: 'future', sessionId: 's1', data: {} }))
    await writeFile(join(dir, `${todayStr()}.jsonl`), JSON.stringify({ eventType: 'today', sessionId: 's2', data: {} }))

    const events = await readTelemetryEvents(dir, 30)
    expect(events.length).toBe(1)
    expect(events[0]!.eventType).toBe('today')
  })

  it('skips malformed lines gracefully', async () => {
    const content = [
      JSON.stringify({ eventType: 'good', sessionId: 's1', data: {} }),
      'not valid json{{{',
      JSON.stringify({ eventType: 'also_good', sessionId: 's2', data: {} }),
    ].join('\n')
    await writeFile(join(dir, `${todayStr()}.jsonl`), content)

    const events = await readTelemetryEvents(dir, 30)
    expect(events.length).toBe(2)
  })
})
