import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionExport,
  ConnectionInput,
  ConnectionView,
  DriverKind,
  KubectlConfig,
  SshDevcontainerConfig,
  TestResult
} from '@shared/types'
import { buildSshDevcontainerScript, defaultReadyRegex } from '@shared/sshDevcontainerScript'
import { buildKubectlScript, defaultKubectlReadyRegex } from '@shared/kubectlScript'
import { Modal } from './Modal'
import { Banner } from './Banner'
import { AlertTriangle, Check, CheckCircle, Copy, Download } from '../icons'
import { showToast } from '../toast'

interface Props {
  connection: ConnectionView | null
  onClose: () => void
  onSaved: (saved: ConnectionView) => void
}

const DEFAULT_PORTS: Record<DriverKind, number> = { postgres: 5432, mysql: 3306 }

const EMPTY_SSH_DEVCONTAINER: SshDevcontainerConfig = {
  sshHost: '',
  workspaceFolder: '',
  portForwardCommand: '',
  remotePort: 5432
}

const EMPTY_KUBECTL: KubectlConfig = {
  kubeconfig: '',
  context: '',
  namespace: '',
  target: '',
  remotePort: 5432
}

const DRIVERS: DriverKind[] = ['postgres', 'mysql']
type PreConnectionMode = NonNullable<ConnectionInput['preConnectionMode']>
const MODES: PreConnectionMode[] = ['none', 'ssh-devcontainer', 'kubectl']
const MODE_LABELS: Record<PreConnectionMode, string> = {
  none: 'None',
  'ssh-devcontainer': 'SSH + devcontainer',
  kubectl: 'kubectl port-forward'
}

/** Modes whose host/port and preScript are generated at connect time. */
const GENERATED_MODES: PreConnectionMode[] = ['ssh-devcontainer', 'kubectl']

/** The whole connection as JSON — every setting, password included. `id` and the
 *  timestamps are left out so a config can be pasted into any connection. */
function toExport(f: ConnectionInput): ConnectionExport {
  return {
    name: f.name,
    driver: f.driver,
    host: f.host,
    port: f.port,
    database: f.database,
    user: f.user,
    password: f.password ?? '',
    ssl: !!f.ssl,
    readOnly: !!f.readOnly,
    preScript: f.preScript,
    preScriptReadyRegex: f.preScriptReadyRegex,
    preScriptWaitMs: f.preScriptWaitMs,
    preConnectionMode: f.preConnectionMode,
    sshDevcontainer: f.sshDevcontainer,
    kubectl: f.kubectl
  }
}

function isSshConfig(v: unknown): v is SshDevcontainerConfig {
  const c = v as SshDevcontainerConfig
  return (
    !!c &&
    typeof c === 'object' &&
    typeof c.sshHost === 'string' &&
    typeof c.workspaceFolder === 'string' &&
    typeof c.portForwardCommand === 'string' &&
    typeof c.remotePort === 'number'
  )
}

function isKubectlConfig(v: unknown): v is KubectlConfig {
  const c = v as KubectlConfig
  return (
    !!c &&
    typeof c === 'object' &&
    typeof c.kubeconfig === 'string' &&
    typeof c.context === 'string' &&
    typeof c.namespace === 'string' &&
    typeof c.target === 'string' &&
    typeof c.remotePort === 'number'
  )
}

/** Picks the recognized, well-typed keys out of arbitrary parsed JSON. Unknown or
 *  wrongly-typed keys are ignored; a patch with nothing usable means "not a config". */
function parseExport(parsed: unknown): Partial<ConnectionInput> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const src = parsed as Record<string, unknown>
  const patch: Partial<ConnectionInput> = {}

  for (const k of ['name', 'host', 'database', 'user', 'password', 'preScript', 'preScriptReadyRegex'] as const) {
    if (typeof src[k] === 'string') patch[k] = src[k] as string
  }
  for (const k of ['port', 'preScriptWaitMs'] as const) {
    if (typeof src[k] === 'number' && Number.isFinite(src[k])) patch[k] = src[k] as number
  }
  for (const k of ['ssl', 'readOnly'] as const) {
    if (typeof src[k] === 'boolean') patch[k] = src[k] as boolean
  }
  if (DRIVERS.includes(src.driver as DriverKind)) patch.driver = src.driver as DriverKind
  if (MODES.includes(src.preConnectionMode as PreConnectionMode)) {
    patch.preConnectionMode = src.preConnectionMode as PreConnectionMode
  }
  // A bare sshDevcontainer object is also accepted, so older ssh-only JSON still imports.
  if (isSshConfig(src.sshDevcontainer)) patch.sshDevcontainer = src.sshDevcontainer
  else if (isSshConfig(src)) patch.sshDevcontainer = src as unknown as SshDevcontainerConfig
  if (isKubectlConfig(src.kubectl)) patch.kubectl = src.kubectl
  else if (isKubectlConfig(src)) patch.kubectl = src as unknown as KubectlConfig

  return Object.keys(patch).length ? patch : null
}

export function ConnectionForm({ connection, onClose, onSaved }: Props): JSX.Element {
  const editing = !!connection
  const initialForm: ConnectionInput = {
    id: connection?.id,
    name: connection?.name ?? '',
    driver: connection?.driver ?? 'postgres',
    host: connection?.host ?? 'localhost',
    port: connection?.port ?? DEFAULT_PORTS.postgres,
    database: connection?.database ?? '',
    user: connection?.user ?? '',
    password: undefined,
    ssl: connection?.ssl ?? false,
    readOnly: connection?.readOnly ?? false,
    preScript: connection?.preScript ?? '',
    preScriptReadyRegex: connection?.preScriptReadyRegex ?? '',
    preScriptWaitMs: connection?.preScriptWaitMs ?? 1500,
    preConnectionMode: connection?.preConnectionMode ?? 'none',
    sshDevcontainer: connection?.sshDevcontainer ?? EMPTY_SSH_DEVCONTAINER,
    kubectl: connection?.kubectl ?? EMPTY_KUBECTL
  }
  const [form, setForm] = useState<ConnectionInput>(initialForm)
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sshHosts, setSshHosts] = useState<string[]>([])
  const [jsonText, setJsonText] = useState(() => JSON.stringify(toExport(initialForm), null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.system.listSshHosts().then(setSshHosts).catch(() => setSshHosts([]))
  }, [])

  /** Single place that keeps the form and the JSON box in sync (field edits win
   *  over whatever was typed in the box). */
  const applyForm = (next: ConnectionInput) => {
    setForm(next)
    setJsonText(JSON.stringify(toExport(next), null, 2))
    setJsonError(null)
  }

  // Pull the stored password in so the JSON box really is the whole connection.
  useEffect(() => {
    if (!connection) return
    window.api.connections
      .exportConfig(connection.id)
      .then((cfg) => applyForm({ ...initialForm, ...cfg, id: connection.id }))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id])

  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) =>
    applyForm({ ...form, [k]: v })

  const setSsh = <K extends keyof SshDevcontainerConfig>(k: K, v: SshDevcontainerConfig[K]) =>
    applyForm({ ...form, sshDevcontainer: { ...(form.sshDevcontainer ?? EMPTY_SSH_DEVCONTAINER), [k]: v } })

  const setKubectl = <K extends keyof KubectlConfig>(k: K, v: KubectlConfig[K]) =>
    applyForm({ ...form, kubectl: { ...(form.kubectl ?? EMPTY_KUBECTL), [k]: v } })

  /** Dynamically interprets whatever JSON is currently typed/pasted: valid and
   *  shaped like a connection -> applied to the form immediately; otherwise the
   *  form is left untouched and an inline error is shown. */
  const onJsonChange = (text: string) => {
    setJsonText(text)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setJsonError('Invalid JSON')
      return
    }
    const patch = parseExport(parsed)
    if (patch) {
      setForm((f) => ({ ...f, ...patch }))
      setJsonError(null)
    } else {
      setJsonError('No recognized connection fields (name, driver, host, port, database, user, password, …)')
    }
  }

  const onCopyJson = async () => {
    await navigator.clipboard.writeText(jsonText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onDownloadJson = () => {
    const slug = (form.name || 'connection').replace(/[^\w.-]+/g, '-').toLowerCase()
    const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onLoadJsonFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => onJsonChange(String(reader.result))
    reader.readAsText(file)
  }

  const generatedScript = useMemo(
    () => (form.sshDevcontainer ? buildSshDevcontainerScript(form.sshDevcontainer, 'auto', 'auto') : ''),
    [form.sshDevcontainer]
  )

  const generatedKubectlScript = useMemo(
    () => (form.kubectl ? buildKubectlScript(form.kubectl, 'auto') : ''),
    [form.kubectl]
  )

  /** Resolves the payload to send to the backend. The actual preScript/host/port
   *  for the generated modes are (re)computed on every connect attempt in the main
   *  process, once a free local port is picked — see
   *  `main/ssh/resolvePreConnection.ts`. Here we just make sure a sensible
   *  placeholder regex is set and host/port aren't left stale from a previous mode. */
  const resolvePayload = (): ConnectionInput => {
    const mode = form.preConnectionMode
    if (mode && GENERATED_MODES.includes(mode)) {
      const fallbackRegex = mode === 'kubectl' ? defaultKubectlReadyRegex() : defaultReadyRegex()
      return {
        ...form,
        host: '127.0.0.1',
        port: 0,
        preScriptReadyRegex: form.preScriptReadyRegex || fallbackRegex
      }
    }
    return form
  }

  const passwordPlaceholder = useMemo(
    () => (editing && connection?.hasPassword ? '•••••• (unchanged)' : ''),
    [editing, connection]
  )

  const save = async (): Promise<ConnectionView> => {
    const payload: ConnectionInput = resolvePayload()
    if (payload.password === undefined || payload.password === '') delete payload.password
    return window.api.connections.save(payload)
  }

  const onSave = async () => {
    setSaving(true)
    try {
      onSaved(await save())
    } catch (e) {
      showToast(`Save failed: ${e}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      // Test the current draft as-is — nothing is persisted until Save.
      const payload: ConnectionInput = resolvePayload()
      if (payload.password === '') delete payload.password
      setTest(await window.api.connections.testDraft(payload))
    } catch (e) {
      setTest({ ok: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit connection' : 'New connection'}
      footer={
        <>
          <button className="mini" onClick={onTest} disabled={testing || !form.name}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <div className="spacer" />
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini primary" onClick={onSave} disabled={saving || !form.name}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
        <div className="form-grid">
          <label className="span2">
            Name
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My database" />
          </label>

          <label>
            Driver
            <select
              value={form.driver}
              onChange={(e) => {
                const d = e.target.value as DriverKind
                set('driver', d)
                set('port', DEFAULT_PORTS[d])
              }}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
            </select>
          </label>

          {!GENERATED_MODES.includes(form.preConnectionMode ?? 'none') && (
            <>
              <label>
                Host
                <input value={form.host} onChange={(e) => set('host', e.target.value)} />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => set('port', Number(e.target.value))}
                />
              </label>
            </>
          )}

          <label>
            Database
            <input value={form.database} onChange={(e) => set('database', e.target.value)} />
          </label>
          <label>
            User
            <input value={form.user} onChange={(e) => set('user', e.target.value)} />
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password ?? ''}
              placeholder={passwordPlaceholder}
              onChange={(e) => set('password', e.target.value)}
            />
          </label>
          <div className="checks">
            <label className="inline">
              <input type="checkbox" checked={!!form.ssl} onChange={(e) => set('ssl', e.target.checked)} />
              SSL
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={!!form.readOnly}
                onChange={(e) => set('readOnly', e.target.checked)}
              />
              Read-only
            </label>
          </div>

          <div className="form-section">
            <h4 className="form-section-title">Pre-connection</h4>
            <label className="span2">
              Mode
              <select
                value={form.preConnectionMode ?? 'none'}
                onChange={(e) => set('preConnectionMode', e.target.value as PreConnectionMode)}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>

            {form.preConnectionMode === 'ssh-devcontainer' && (
            <>
              <label>
                SSH host
                <select
                  value={form.sshDevcontainer?.sshHost ?? ''}
                  onChange={(e) => setSsh('sshHost', e.target.value)}
                >
                  <option value="">Select a host…</option>
                  {sshHosts.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <small>Parsed from ~/.ssh/config.</small>
              </label>
              <label>
                Devcontainer workspace folder
                <input
                  className="mono"
                  placeholder="/home/simone/repo/if-sysadmin"
                  value={form.sshDevcontainer?.workspaceFolder ?? ''}
                  onChange={(e) => setSsh('workspaceFolder', e.target.value)}
                />
              </label>

              <label className="span2">
                Port-forward command (runs inside the devcontainer)
                <textarea
                  className="mono"
                  rows={3}
                  spellCheck={false}
                  placeholder="kubectl port-forward svc/fantaglia-pg-cluster-rw 5432:5432 --kubeconfig /workspace/.devcontainer/gitignored/.kube/conf.yaml --context cfi-stg"
                  value={form.sshDevcontainer?.portForwardCommand ?? ''}
                  onChange={(e) => setSsh('portForwardCommand', e.target.value)}
                />
              </label>

              <label>
                Remote port (inside devcontainer)
                <input
                  type="number"
                  value={form.sshDevcontainer?.remotePort ?? 0}
                  onChange={(e) => setSsh('remotePort', Number(e.target.value))}
                />
                <small>The local port and Host/Database Port above are chosen automatically — a free port is picked on this machine each time you connect.</small>
              </label>

              <label>
                Ready when output matches (regex)
                <input
                  className="mono"
                  placeholder="Forwarding from"
                  value={form.preScriptReadyRegex}
                  onChange={(e) => set('preScriptReadyRegex', e.target.value)}
                />
                <small>Defaults to "Forwarding from" if left blank.</small>
              </label>

              <details className="span2">
                <summary>Generated script</summary>
                <pre className="mono generated-script">{generatedScript}</pre>
              </details>
            </>
            )}

            {form.preConnectionMode === 'kubectl' && (
            <>
              <label>
                Kubeconfig
                <input
                  className="mono"
                  placeholder="/Users/simone/.kube/pho-dev.yaml"
                  value={form.kubectl?.kubeconfig ?? ''}
                  onChange={(e) => setKubectl('kubeconfig', e.target.value)}
                />
                <small>Leave blank for kubectl's own default.</small>
              </label>
              <label>
                Context
                <input
                  className="mono"
                  placeholder="pho-dev"
                  value={form.kubectl?.context ?? ''}
                  onChange={(e) => setKubectl('context', e.target.value)}
                />
                <small>Leave blank for the kubeconfig's current-context.</small>
              </label>
              <label>
                Namespace
                <input
                  className="mono"
                  placeholder="mind"
                  value={form.kubectl?.namespace ?? ''}
                  onChange={(e) => setKubectl('namespace', e.target.value)}
                />
              </label>
              <label>
                Target
                <input
                  className="mono"
                  placeholder="svc/erbavita-pg-cluster-rw"
                  value={form.kubectl?.target ?? ''}
                  onChange={(e) => setKubectl('target', e.target.value)}
                />
              </label>

              <label>
                Remote port
                <input
                  type="number"
                  value={form.kubectl?.remotePort ?? 0}
                  onChange={(e) => setKubectl('remotePort', Number(e.target.value))}
                />
                <small>The local port and Host/Port above are chosen automatically — a free port is picked on this machine each time you connect.</small>
              </label>

              <label>
                Ready when output matches (regex)
                <input
                  className="mono"
                  placeholder="Forwarding from"
                  value={form.preScriptReadyRegex}
                  onChange={(e) => set('preScriptReadyRegex', e.target.value)}
                />
                <small>Defaults to "Forwarding from" if left blank.</small>
              </label>

              <details className="span2">
                <summary>Generated script</summary>
                <pre className="mono generated-script">{generatedKubectlScript}</pre>
              </details>
            </>
            )}
          </div>

          <div className="form-section">
            <h4 className="form-section-title">Export / import</h4>
          <label className="span2">
            <div className="json-header">
              <span>Connection JSON</span>
              <div className="json-actions">
                <button type="button" className="mini ghost" onClick={onCopyJson}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="mini ghost" onClick={onDownloadJson}>
                  <Download />
                  Save…
                </button>
                <button type="button" className="mini ghost" onClick={() => fileInputRef.current?.click()}>
                  Load…
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onLoadJsonFile(file)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <textarea
              className="mono"
              rows={12}
              spellCheck={false}
              value={jsonText}
              onChange={(e) => onJsonChange(e.target.value)}
            />
            <small>
              The whole connection — <strong>password in plaintext included</strong>. Paste or edit here and
              it's applied live to the fields above; Save still has to be pressed.
            </small>
          </label>
          {jsonError && <Banner kind="warn" message={jsonError} className="span2" />}
          </div>
        </div>

        {test && (
          <div className={`test-result ${test.ok ? 'ok' : 'fail'}`}>
            {test.ok ? <CheckCircle /> : <AlertTriangle />}
            {test.ok ? `${test.message} (${test.latencyMs} ms)` : test.message}
          </div>
        )}
    </Modal>
  )
}
