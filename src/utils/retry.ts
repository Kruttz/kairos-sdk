export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  shouldRetry?: (err: unknown) => boolean,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const jitter = Math.random() * delayMs * 0.5
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1) + jitter))
    }
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (shouldRetry && !shouldRetry(err)) throw err
    }
  }
  throw lastError
}

export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}
