/**
 * Tiny zero-dep concurrency limiter.
 *
 *   const sem = new Semaphore(4)
 *   await sem.run(() => doThing())
 */
export class Semaphore {
  private active = 0
  private readonly waiters: (() => void)[] = []

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be >= 1')
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.waiters.shift()
    if (next) next()
  }
}
