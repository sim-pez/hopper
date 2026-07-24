import type { SshDevcontainerConfig } from './types'

const DEFAULT_READY_REGEX = 'Forwarding from'

/** Wraps a string in single quotes for safe interpolation as a standalone shell word. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Escapes a value for embedding inside a *double-quoted* bash string without
 *  letting it inject code or get expanded by the local shell prematurely. */
function dq(value: string): string {
  return value.replace(/[\\$`"]/g, '\\$&')
}

/** Generates the bash pre-connection script for the SSH + devcontainer wizard.
 *
 *  `localPort` is resolved fresh per connection attempt (a free local port picked
 *  right before the script runs — see `main/ssh/resolvePreConnection.ts`), so it's
 *  never persisted in `SshDevcontainerConfig`. Pass `'auto'` only for a preview
 *  render where the real port isn't known yet.
 *
 *  Two quoting pitfalls this works around (verified against a real cloudflared-proxied
 *  SSH host):
 *
 *  1. `ssh host bash -lc '...'` — a login shell's profile-sourcing was observed to
 *     reliably swallow the command's stdout on the direct (non-pty) channel, even
 *     though the command itself ran. So every remote command uses
 *     `bash --noprofile --norc -c` instead, and sources nvm explicitly (if present)
 *     since login-shell PATH setup can't be relied on.
 *
 *  2. `ssh host bash --noprofile --norc -c "cmd"` passed as *separate* ssh arguments
 *     is unsafe: ssh joins all trailing arguments with spaces and the remote shell
 *     re-parses the joined string from scratch, so `-c`'s "argument" ends up being
 *     just the first word of "cmd" — everything after silently becomes bash's
 *     positional parameters instead of part of the command. Fixed by building the
 *     remote command in a local variable, `printf '%q'`-quoting it into a single
 *     re-parseable token, and passing the whole `bash ... -c <token>` as ONE
 *     double-quoted ssh argument. */
export function buildSshDevcontainerScript(cfg: SshDevcontainerConfig, localPort: number | 'auto'): string {
  const host = sq(cfg.sshHost)
  const workspace = dq(cfg.workspaceFolder)
  const portForwardCommand = dq(cfg.portForwardCommand)
  const localPortText = localPort === 'auto' ? '<auto-selected-port>' : String(localPort)

  return `set -euo pipefail
NVM_PREFIX='export NVM_DIR=$HOME/.nvm; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh >/dev/null 2>&1; '

UP_CMD="\${NVM_PREFIX}devcontainer up --workspace-folder \\"${workspace}\\" --log-format json"
OUT=$(ssh ${host} "bash --noprofile --norc -c $(printf '%q' "$UP_CMD")")
CID=$(echo "$OUT" | grep -o '"containerId":"[^"]*"' | tail -1 | cut -d'"' -f4)

INSPECT_CMD="\${NVM_PREFIX}docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $CID"
CIP=$(ssh ${host} "bash --noprofile --norc -c $(printf '%q' "$INSPECT_CMD")")
CIP=\${CIP:-127.0.0.1}

EXEC_CMD="\${NVM_PREFIX}devcontainer exec --workspace-folder \\"${workspace}\\" -- ${portForwardCommand}"
exec ssh -L "${localPortText}:$CIP:${cfg.remotePort}" ${host} "bash --noprofile --norc -c $(printf '%q' "$EXEC_CMD")"
`
}

export function defaultReadyRegex(): string {
  return DEFAULT_READY_REGEX
}
