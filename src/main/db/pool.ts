import type { ConnectionStatus } from '@shared/types'
import { getConnection } from '../store/connectionStore'
import { getPassword } from '../store/secrets'
import { preScriptRunner } from '../process/preScriptRunner'
import { resolvePreConnection } from '../ssh/resolvePreConnection'
import type { Driver } from './types'
import { PostgresDriver } from './postgres'
import { MysqlDriver } from './mysql'

interface Live {
  driver: Driver
}

const live = new Map<string, Live>()
const states = new Map<string, ConnectionStatus>()

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

export async function connect(id: string): Promise<ConnectionStatus> {
  const stored = await getConnection(id)
  if (!stored) throw new Error(`Connection ${id} not found`)

  if (live.has(id)) return setStatus(id, { state: 'connected', error: undefined })

  try {
    setStatus(id, { state: 'starting-script', error: undefined })
    const cfg = await resolvePreConnection(stored)
    await preScriptRunner.start(cfg)

    setStatus(id, { state: 'connecting' })
    const password = await getPassword(id)
    const driver = createDriver(cfg.driver)
    await driver.connect(cfg, password)

    live.set(id, { driver })
    return setStatus(id, { state: 'connected', error: undefined })
  } catch (err) {
    preScriptRunner.stop(id)
    return setStatus(id, { state: 'error', error: (err as Error).message })
  }
}

export async function disconnect(id: string): Promise<ConnectionStatus> {
  const entry = live.get(id)
  if (entry) {
    try {
      await entry.driver.end()
    } catch {
      /* ignore */
    }
    live.delete(id)
  }
  preScriptRunner.stop(id)
  return setStatus(id, { state: 'disconnected', error: undefined })
}

export function getDriver(id: string): Driver {
  const entry = live.get(id)
  if (!entry) throw new Error('Not connected')
  return entry.driver
}

export async function shutdownAll(): Promise<void> {
  for (const id of [...live.keys()]) await disconnect(id)
  preScriptRunner.stopAll()
}
