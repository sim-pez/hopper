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

/** Picks a random port in the dynamic/private range (49152-65535) for a bind that
 *  happens on a *remote* host we have no socket API access to (e.g. inside a
 *  devcontainer over ssh), so it can't be OS-verified free like `getFreePort()`.
 *  Rotating the port on every attempt is still enough to dodge a leftover process
 *  from a prior run that was pinned to one fixed port. */
export function randomRemotePort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152 + 1))
}
