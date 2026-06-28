import { describe, it, expect } from 'vitest'
import { createLogger, nullLogger } from '../../../src/utils/logger.js'

function makeCapture() {
  const lines: string[] = []
  return { destination: { write: (s: string) => { lines.push(s) } }, lines }
}

describe('nullLogger', () => {
  it('does nothing', () => {
    expect(() => {
      nullLogger.debug('x')
      nullLogger.info('x')
      nullLogger.warn('x')
      nullLogger.error('x')
    }).not.toThrow()
  })
})

describe('createLogger — human-readable', () => {
  it('writes info lines to destination', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ destination })
    log.info('hello world')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[INFO] hello world')
  })

  it('includes meta as key=value pairs', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ destination })
    log.warn('check', { rule: 5, ok: true })
    expect(lines[0]).toMatch(/rule=5/)
    expect(lines[0]).toMatch(/ok=true/)
  })

  it('suppresses levels below minimum', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ level: 'warn', destination })
    log.debug('skip me')
    log.info('skip me too')
    log.warn('keep me')
    log.error('keep me also')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[WARN]')
    expect(lines[1]).toContain('[ERROR]')
  })

  it('debug level emits everything', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ level: 'debug', destination })
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(lines).toHaveLength(4)
  })
})

describe('createLogger — JSON mode', () => {
  it('outputs valid JSON lines', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ json: true, destination })
    log.info('msg here', { count: 3 })
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('msg here')
    expect(parsed.count).toBe(3)
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('respects level filtering in JSON mode', () => {
    const { destination, lines } = makeCapture()
    const log = createLogger({ level: 'error', json: true, destination })
    log.warn('ignored')
    log.error('kept')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).level).toBe('error')
  })
})
