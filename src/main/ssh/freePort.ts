import { createServer } from 'net'

/** Asks the OS for an unused local port by binding to port 0, then releasing it.
 *  Small window for another process to grab it before the real bind — acceptable
 *  here since the real bind happens moments later as part of the same connect. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Could not determine a free port'))
      })
    })
  })
}
