import type { ConnectionConfig } from '@shared/types'
import { buildSshDevcontainerScript, defaultReadyRegex } from '@shared/sshDevcontainerScript'
import { getFreePort } from './freePort'

/** For SSH + devcontainer connections, picks a fresh free local port, generates the
 *  pre-script against it, and points host/port at the resulting tunnel — so neither
 *  needs to be (or can be) hand-configured. No-op for any other connection. */
export async function resolvePreConnection(cfg: ConnectionConfig): Promise<ConnectionConfig> {
  if (cfg.preConnectionMode !== 'ssh-devcontainer' || !cfg.sshDevcontainer) return cfg

  const localPort = await getFreePort()
  return {
    ...cfg,
    host: '127.0.0.1',
    port: localPort,
    preScript: buildSshDevcontainerScript(cfg.sshDevcontainer, localPort),
    preScriptReadyRegex: cfg.preScriptReadyRegex || defaultReadyRegex()
  }
}
