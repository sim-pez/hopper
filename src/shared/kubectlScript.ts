import type { KubectlConfig } from './types'

const DEFAULT_READY_REGEX = 'Forwarding from'

/** Wraps a string in single quotes for safe interpolation as a standalone shell word. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Generates the bash pre-connection script for a plain local `kubectl port-forward`.
 *
 *  `localPort` is resolved fresh on every connection attempt (see
 *  `main/ssh/resolvePreConnection.ts`) rather than persisted, so two connections in the
 *  same workspace can be live at once and a leftover forward from a prior run can't
 *  collide with a fixed port. Pass `'auto'` for a preview render where the real port
 *  isn't known yet.
 *
 *  `exec` replaces the wrapping bash, so the pid tracked by `preScriptRunner` is kubectl
 *  itself and the ready-regex match comes from kubectl's own
 *  "Forwarding from 127.0.0.1:… -> …" line. Everything is single-quoted: the script is
 *  built from user-entered fields and must not let them inject shell code. */
export function buildKubectlScript(cfg: KubectlConfig, localPort: number | 'auto'): string {
  const localPortText = localPort === 'auto' ? '<auto-selected-port>' : String(localPort)
  const args = [sq(cfg.target), sq(`${localPortText}:${cfg.remotePort}`)]
  if (cfg.namespace.trim()) args.push('--namespace', sq(cfg.namespace.trim()))
  if (cfg.kubeconfig.trim()) args.push('--kubeconfig', sq(cfg.kubeconfig.trim()))
  if (cfg.context.trim()) args.push('--context', sq(cfg.context.trim()))

  return `set -euo pipefail
exec kubectl port-forward ${args.join(' ')}
`
}

export function defaultKubectlReadyRegex(): string {
  return DEFAULT_READY_REGEX
}
