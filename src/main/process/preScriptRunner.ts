import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type { ConnectionConfig, ScriptOutput } from '@shared/types'

interface RunningScript {
  child: ChildProcess
  exited: boolean
}

/**
 * Runs and tracks per-connection pre-connection bash scripts (e.g. a
 * `kubectl port-forward` that must stay alive while the DB is in use).
 *
 * Emits 'output' with ScriptOutput payloads. Scripts are spawned in their own
 * process group (detached) so the whole group can be terminated on disconnect.
 */
/**
 * Vars an AppImage's runtime rewrites to point at its own bundled libraries. A child
 * process (kubectl, ssh, psql…) inheriting them loads those libs instead of the system
 * ones and dies on a glibc/OpenSSL mismatch. The runtime stashes the pre-launch value in
 * `<VAR>_ORIG`, so restore that where it exists and drop the var otherwise.
 */
const APPIMAGE_VARS = [
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'PYTHONPATH',
  'PERLLIB',
  'GSETTINGS_SCHEMA_DIR',
  'QT_PLUGIN_PATH',
  'GTK_PATH',
  'GDK_PIXBUF_MODULE_FILE',
  'GDK_PIXBUF_MODULEDIR',
  'XDG_DATA_DIRS'
]

/** The environment a pre-connection script should see: the user's, not Electron's. */
function scriptEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (!env.APPIMAGE) return env
  for (const name of APPIMAGE_VARS) {
    const orig = env[`${name}_ORIG`]
    if (orig != null && orig !== '') env[name] = orig
    else delete env[name]
  }
  return env
}

class PreScriptRunner extends EventEmitter {
  private running = new Map<string, RunningScript>()

  isRunning(id: string): boolean {
    const r = this.running.get(id)
    return !!r && !r.exited
  }

  private emitOutput(id: string, stream: ScriptOutput['stream'], data: string): void {
    this.emit('output', { id, stream, data, ts: Date.now() } as ScriptOutput)
  }

  /**
   * Starts the script (if any) and resolves once it is considered "ready":
   * - no script            -> resolve immediately
   * - preScriptReadyRegex  -> resolve when a matching line is seen
   * - otherwise            -> resolve after preScriptWaitMs (default 1500ms)
   * Rejects if the process exits with a non-zero code before becoming ready.
   */
  async start(cfg: ConnectionConfig): Promise<void> {
    if (!cfg.preScript || !cfg.preScript.trim()) return

    // Replace any previous run for this connection.
    this.stop(cfg.id)

    const child = spawn('bash', ['-lc', cfg.preScript], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: scriptEnv()
    })
    const record: RunningScript = { child, exited: false }
    this.running.set(cfg.id, record)
    this.emitOutput(cfg.id, 'system', `$ started pre-connection script (pid ${child.pid})\n`)

    const readyRegex = cfg.preScriptReadyRegex ? new RegExp(cfg.preScriptReadyRegex) : null
    const waitMs = cfg.preScriptWaitMs ?? 1500

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const done = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      const onData = (buf: Buffer, stream: 'stdout' | 'stderr') => {
        const text = buf.toString()
        this.emitOutput(cfg.id, stream, text)
        if (readyRegex && readyRegex.test(text)) {
          done(resolve)
        }
      }
      child.stdout?.on('data', (b: Buffer) => onData(b, 'stdout'))
      child.stderr?.on('data', (b: Buffer) => onData(b, 'stderr'))

      child.on('error', (err) => {
        record.exited = true
        this.emitOutput(cfg.id, 'system', `script error: ${err.message}\n`)
        done(() => reject(err))
      })

      child.on('exit', (code, signal) => {
        record.exited = true
        this.emitOutput(cfg.id, 'system', `script exited (code=${code ?? 'null'} signal=${signal ?? 'null'})\n`)
        // A clean (code 0, no signal) exit is a normal one-shot script finishing —
        // only surface non-clean exits as potential connection-affecting events,
        // so consumers don't tear down a live connection whose setup script
        // simply completed successfully.
        if (code !== 0 || signal) this.emit('exit', cfg.id, code, signal)
        // Exiting before ready is only a failure for a non-zero code.
        if (code && code !== 0) done(() => reject(new Error(`Pre-connection script exited with code ${code}`)))
        else done(resolve) // e.g. a one-shot setup script that finished cleanly
      })

      if (!readyRegex) {
        setTimeout(() => done(resolve), waitMs)
      }
    })
  }

  stop(id: string): void {
    const record = this.running.get(id)
    if (!record) return
    const { child } = record
    if (!record.exited && child.pid != null) {
      try {
        // Negative pid targets the whole process group (detached spawn).
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already gone */
        }
      }
    }
    this.running.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }
}

export const preScriptRunner = new PreScriptRunner()
