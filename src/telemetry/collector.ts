import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateUUID } from '../utils/uuid.js'
import type { TelemetryEvent } from './types.js'

export class TelemetryCollector {
  private readonly dir: string
  readonly sessionId: string

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), '.kairos', 'telemetry')
    this.sessionId = generateUUID()
  }

  async emit(eventType: TelemetryEvent['eventType'], data: Record<string, unknown>): Promise<void> {
    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      eventType,
      data,
    }

    await mkdir(this.dir, { recursive: true })
    const filename = new Date().toISOString().slice(0, 10) + '.jsonl'
    const filepath = join(this.dir, filename)
    await appendFile(filepath, JSON.stringify(event) + '\n', 'utf-8')
  }
}
