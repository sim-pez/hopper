import type { ConnectionConfig } from '@shared/types'
import { buildSshDevcontainerScript, defaultReadyRegex } from '@shared/sshDevcontainerScript'
import { buildKubectlScript, defaultKubectlReadyRegex } from '@shared/kubectlScript'
import { getFreePort, randomRemotePort } from './freePort'

/** For the generated pre-connection modes, picks a fresh free local port, builds the
 *  pre-script against it, and points host/port at the resulting tunnel — so none of it
 *  needs to be (or can be) hand-configured. No-op for `'none'`, whose `preScript` and
 *  host/port are used exactly as saved. */
export async function resolvePreConnection(cfg: ConnectionConfig): Promise<ConnectionConfig> {
  if (cfg.preConnectionMode === 'ssh-devcontainer' && cfg.sshDevcontainer) {
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

  if (cfg.preConnectionMode === 'kubectl' && cfg.kubectl) {
    const localPort = await getFreePort()
    return {
      ...cfg,
      host: '127.0.0.1',
      port: localPort,
      preScript: buildKubectlScript(cfg.kubectl, localPort),
      preScriptReadyRegex: cfg.preScriptReadyRegex || defaultKubectlReadyRegex()
    }
  }

  return cfg
}
