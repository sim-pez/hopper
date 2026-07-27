import type { ConnectionConfig, ConnectionStatus } from '@shared/types'
import { getConnection } from '../store/connectionStore'
import { getPassword } from '../store/secrets'
import { preScriptRunner } from '../process/preScriptRunner'
import { resolvePreConnection } from '../ssh/resolvePreConnection'
import type { Driver } from './types'
import { PostgresDriver } from './postgres'
import { MysqlDriver } from './mysql'

interface Live {
  driver: Driver
  /** Fingerprint of the settings this driver was connected with, to detect
   *  edits made to the saved connection while it's live. */
  signature: string
}

const live = new Map<string, Live>()
const states = new Map<string, ConnectionStatus>()
const healthTimers = new Map<string, NodeJS.Timeout>()
const HEALTH_INTERVAL_MS = 20_000

/** Backoff between automatic reconnect attempts after a connection drops on its
 *  own. One entry per attempt, so the length is also the attempt limit. */
const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000]

/** Cancellation token for an in-flight reconnect sequence. */
interface Reconnect {
  timer: NodeJS.Timeout | null
  cancelled: boolean
}
const reconnects = new Map<string, Reconnect>()

function signatureOf(cfg: ConnectionConfig, password: string | undefined): string {
  return JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    ssl: cfg.ssl,
    readOnly: cfg.readOnly,
    preScript: cfg.preScript,
    preScriptReadyRegex: cfg.preScriptReadyRegex,
    password
  })
}

type StatusListener = (status: ConnectionStatus) => void
const listeners = new Set<StatusListener>()

export function onStatusChange(cb: StatusListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setStatus(id: string, patch: Partial<ConnectionStatus>): ConnectionStatus {
  const prev = states.get(id) ?? { id, state: 'disconnected', scriptRunning: false }
  const next: ConnectionStatus = { ...prev, ...patch, id, scriptRunning: preScriptRunner.isRunning(id) }
  states.set(id, next)
  for (const l of listeners) l(next)
  return next
}

export function getStatus(id: string): ConnectionStatus {
  return states.get(id) ?? { id, state: 'disconnected', scriptRunning: preScriptRunner.isRunning(id) }
}

function createDriver(kind: string): Driver {
  switch (kind) {
    case 'postgres':
      return new PostgresDriver()
    case 'mysql':
      return new MysqlDriver()
    default:
      throw new Error(`Unsupported driver: ${kind}`)
  }
}

/** Current settings for a connection: for the generated pre-connection modes
 *  this picks a fresh free local port every time it is called. */
async function resolveSettings(
  id: string
): Promise<{ cfg: ConnectionConfig; password: string | undefined; signature: string }> {
  const stored = await getConnection(id)
  if (!stored) throw new Error(`Connection ${id} not found`)
  const cfg = await resolvePreConnection(stored)
  const password = await getPassword(id)
  return { cfg, password, signature: signatureOf(cfg, password) }
}

/** Run the pre-script and connect a driver, registering it as live. Throws (after
 *  stopping the script) if either step fails. Emits the intermediate
 *  starting-script/connecting statuses only when `progress` is set — a silent
 *  reconnect keeps its own `reconnecting` status on screen instead. */
async function open(
  id: string,
  cfg: ConnectionConfig,
  password: string | undefined,
  signature: string,
  progress: boolean
): Promise<void> {
  try {
    if (progress) setStatus(id, { state: 'starting-script', error: undefined })
    await preScriptRunner.start(cfg)

    if (progress) setStatus(id, { state: 'connecting' })
    const driver = createDriver(cfg.driver)
    await driver.connect(cfg, password)

    live.set(id, { driver, signature })
    startHealthCheck(id)
  } catch (err) {
    preScriptRunner.stop(id)
    throw err
  }
}

export async function connect(id: string): Promise<ConnectionStatus> {
  // A deliberate connect supersedes whatever automatic recovery was in flight.
  cancelReconnect(id)
  const { cfg, password, signature } = await resolveSettings(id)

  const existing = live.get(id)
  if (existing) {
    // Already connected with the same settings — nothing to do.
    if (existing.signature === signature) return setStatus(id, { state: 'connected', error: undefined })
    // The saved connection was edited since we connected — drop the stale
    // driver and reconnect below with the current settings.
    await disconnect(id)
  }

  try {
    await open(id, cfg, password, signature, true)
    return setStatus(id, { state: 'connected', error: undefined, reconnectAttempt: undefined })
  } catch (err) {
    return setStatus(id, { state: 'error', error: (err as Error).message })
  }
}

export async function disconnect(id: string): Promise<ConnectionStatus> {
  cancelReconnect(id)
  await teardown(id)
  return setStatus(id, { state: 'disconnected', error: undefined, reconnectAttempt: undefined })
}

/** Drop the live driver and its pre-script without touching the status. */
async function teardown(id: string): Promise<void> {
  stopHealthCheck(id)
  const entry = live.get(id)
  if (entry) {
    live.delete(id)
    try {
      await entry.driver.end()
    } catch {
      /* ignore */
    }
  }
  preScriptRunner.stop(id)
}

export function getDriver(id: string): Driver {
  const entry = live.get(id)
  if (!entry) throw new Error('Not connected')
  return entry.driver
}

export async function cancelQuery(id: string): Promise<void> {
  await live.get(id)?.driver.cancelCurrent()
}

function startHealthCheck(id: string): void {
  stopHealthCheck(id)
  healthTimers.set(
    id,
    setInterval(() => {
      void runHealthCheck(id)
    }, HEALTH_INTERVAL_MS)
  )
}

function stopHealthCheck(id: string): void {
  const timer = healthTimers.get(id)
  if (timer) {
    clearInterval(timer)
    healthTimers.delete(id)
  }
}

async function runHealthCheck(id: string): Promise<void> {
  const entry = live.get(id)
  if (!entry) return stopHealthCheck(id)
  try {
    await entry.driver.ping()
  } catch (err) {
    await handleDrop(id, `Connection lost: ${(err as Error).message}`)
  }
}

/** Ping every live connection right now instead of waiting for the next tick.
 *  Called when the machine wakes up, where a tunnel is very likely already dead
 *  but nothing has noticed yet. */
export function checkAllConnections(): void {
  for (const id of [...live.keys()]) void runHealthCheck(id)
}

/** A live connection died on its own (its pre-connection script exited, or a
 *  health-check ping failed) — as opposed to `disconnect()`, which is a
 *  deliberate user action. Tear it down and try to bring it back: a
 *  `kubectl port-forward` dies routinely (pod restart, expired credentials,
 *  laptop sleep) and re-establishing it is exactly what the user would do by
 *  hand. Each attempt re-resolves the config, so generated modes get a fresh
 *  free local port rather than reusing the dead one. */
async function handleDrop(id: string, reason: string): Promise<void> {
  await teardown(id)
  scheduleReconnect(id, reason)
}

function cancelReconnect(id: string): void {
  const pending = reconnects.get(id)
  if (!pending) return
  pending.cancelled = true
  if (pending.timer) clearTimeout(pending.timer)
  reconnects.delete(id)
}

function scheduleReconnect(id: string, reason: string): void {
  cancelReconnect(id)
  const token: Reconnect = { timer: null, cancelled: false }
  reconnects.set(id, token)

  const attempt = (n: number): void => {
    if (token.cancelled) return
    setStatus(id, { state: 'reconnecting', error: reason, reconnectAttempt: n })
    token.timer = setTimeout(() => {
      void (async () => {
        if (token.cancelled) return
        try {
          const { cfg, password, signature } = await resolveSettings(id)
          if (token.cancelled) return
          await open(id, cfg, password, signature, false)
          if (token.cancelled) return await teardown(id)
          reconnects.delete(id)
          setStatus(id, { state: 'connected', error: undefined, reconnectAttempt: undefined })
        } catch (err) {
          if (token.cancelled) return
          if (n < RECONNECT_DELAYS_MS.length) return attempt(n + 1)
          reconnects.delete(id)
          setStatus(id, {
            state: 'error',
            error: `${reason} — could not reconnect: ${(err as Error).message}`,
            reconnectAttempt: undefined
          })
        }
      })()
    }, RECONNECT_DELAYS_MS[n - 1])
  }

  attempt(1)
}

// If the pre-connection script (e.g. a `kubectl port-forward`) dies while a
// connection is live, the driver would otherwise keep reporting "connected"
// until the next query fails.
preScriptRunner.on('exit', (id: string) => {
  if (live.has(id)) void handleDrop(id, 'Pre-connection script exited unexpectedly')
})

export async function shutdownAll(): Promise<void> {
  for (const id of [...reconnects.keys()]) cancelReconnect(id)
  for (const id of [...live.keys()]) await disconnect(id)
  preScriptRunner.stopAll()
}
