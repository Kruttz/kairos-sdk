import { readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export interface RawTelemetryEvent {
  eventType: string
  sessionId: string
  runId?: string
  data: Record<string, unknown>
  fileDate: string
}

export async function readTelemetryEvents(dir: string, days: number): Promise<RawTelemetryEvent[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const todayStr = new Date().toISOString().slice(0, 10)
  const datePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/
  const recentFiles = files
    .filter(f => datePattern.test(f) && f >= cutoffStr && f <= `${todayStr}.jsonl`)
    .sort()

  const events: RawTelemetryEvent[] = []
  for (const file of recentFiles) {
    const fileDate = file.replace('.jsonl', '')
    try {
      const rl = createInterface({
        input: createReadStream(join(dir, file), 'utf-8'),
        crlfDelay: Infinity,
      })
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          events.push({ ...JSON.parse(line), fileDate })
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable */ }
  }
  return events
}
