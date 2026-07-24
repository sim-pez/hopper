import type { ConnectionConfig } from '@shared/types'
import { buildSshDevcontainerScript, defaultReadyRegex } from '@shared/sshDevcontainerScript'
import { getFreePort, randomRemotePort } from './freePort'

/** For SSH + devcontainer connections, picks a fresh free local port and a fresh
 *  container-side port, generates the pre-script against both, and points host/port at
 *  the resulting tunnel — so none of it needs to be (or can be) hand-configured. No-op
 *  for any other connection. */
export async function resolvePreConnection(cfg: ConnectionConfig): Promise<ConnectionConfig> {
  if (cfg.preConnectionMode !== 'ssh-devcontainer' || !cfg.sshDevcontainer) return cfg

  const localPort = await getFreePort()
  const containerPort = randomRemotePort()
  return {
    ...cfg,
    host: '127.0.0.1',
    port: localPort,
    preScript: buildSshDevcontainerScript(cfg.sshDevcontainer, localPort, containerPort),
    preScriptReadyRegex: cfg.preScriptReadyRegex || defaultReadyRegex()
  }
}
