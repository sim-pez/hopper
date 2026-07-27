# CLAUDE.md — db-manager

Desktop database client (Electron + React + TypeScript) for databases reachable only
after a **pre-connection script** (e.g. `kubectl port-forward` into a cluster).

## Commands

```bash
npm run dev         # launch Electron with HMR
npm run build       # production build -> out/
npm run typecheck   # tsc for main+preload (node) and renderer (web)
npm run preview     # build then run the packaged main
```

Always run `npm run typecheck` before considering a change done — there is no test suite yet.

## Hard constraints (don't break these)

- **Stay on Vite ^7 and @vitejs/plugin-react ^5.** electron-vite 5 does NOT support Vite 8.
  Under Vite 8 externalization breaks and bundles `electron`/`pg`/`mysql2` into the main
  process, crashing at startup (`out/main/index.js` should be ~23 KB CJS, not a 1.2 MB
  `.mjs`). `npm view <pkg> version` returns bleeding-edge tags — check electron-vite's peer
  range before bumping.
- **Do not add `externalizeDepsPlugin()`** to `electron.vite.config.ts`. It's deprecated and
  overrides the preset that externalizes `electron`. `build.externalizeDeps` defaults to true.
- **Never expose passwords to the renderer**, with one deliberate exception:
  `connections.exportConfig(id)` returns the full connection incl. the plaintext password,
  for the export/import JSON box in `ConnectionForm`. Everything else (`list`, `save`, …)
  returns only `hasPassword`. Passwords live encrypted via `safeStorage`
  (`src/main/store/secrets.ts`).
- **All SQL uses bound parameters**; identifiers are quoted per-driver (`quoteIdent`). No
  string interpolation of user values into SQL.

## Architecture

```
src/
  shared/types.ts   Single source of truth for types shared across all 3 layers,
                    including the `Api` shape exposed on window.api.
  main/             Electron main (Node). Entry: main/index.ts
    ipc.ts          ipcMain handlers -> services; broadcasts script output/status.
    store/          jsonStore (fs-based, replaces ESM-only electron-store),
                    connectionStore (CRUD), workspaceStore (connection groups +
                    active selection), secrets (keychain).
    process/        preScriptRunner — spawns/tracks/kills pre-connection scripts.
    db/             Driver interface (types.ts) + postgres.ts + mysql.ts + pool.ts
                    (connection registry, orchestrates pre-script -> connect, and
                    auto-reconnects a connection that drops) + ddl.ts (synthesized
                    CREATE TABLE for engines that can't dump their own).
  preload/index.ts  contextBridge exposing window.api (contextIsolation on).
  renderer/src/     React UI: store.ts (zustand), components/, styles.css.
```

Data flow: renderer → `window.api.*` (preload) → `ipcRenderer.invoke` → `ipc.ts` handler →
`pool.getDriver(id)` → driver method. Script output & connection status flow back via
`webContents.send` → `window.api.scripts.on*`.

## Conventions

- **Adding a DB engine:** implement `Driver` (`src/main/db/types.ts`), register it in
  `createDriver()` (`src/main/db/pool.ts`), add the kind to `DriverKind` in `shared/types.ts`
  and the driver `<select>` in `ConnectionForm.tsx`. In MySQL a "schema" == a database.
- **Pre-connection modes.** `preConnectionMode` picks where `preScript`/`host`/`port` come
  from. `'none'` runs the saved `preScript` verbatim against the saved host/port.
  `'ssh-devcontainer'` and `'kubectl'` are *generated*: their script is built from a
  structured config (`sshDevcontainer` / `kubectl`) by a builder in `shared/`, and
  `main/ssh/resolvePreConnection.ts` rebuilds it on **every** connect against a freshly
  picked free local port — so no local port is ever persisted (saved `host`/`port` are
  placeholders, and two connections can be live at once). Adding a mode: extend the union
  in `shared/types.ts`, add a `build*Script` + `default*ReadyRegex` in `shared/`, a branch in
  `resolvePreConnection`, a `MODES`/`MODE_LABELS` entry + field block + type guard (for the
  JSON import whitelist) in `ConnectionForm.tsx`, and `hasPreScript` in `Sidebar.tsx`.
  Everything interpolated into a generated script must be shell-quoted — see `sq()`.
- **A dropped connection heals itself.** When a live connection dies on its own — its
  pre-script exited, or the 20s health-check ping failed — `pool.ts` tears it down and
  retries 3 times with backoff (`RECONNECT_DELAYS_MS`), state `'reconnecting'`, each attempt
  re-running `resolvePreConnection` so a generated mode gets a *fresh* free local port. A
  deliberate `connect`/`disconnect` cancels whatever retry is in flight. `powerMonitor`'s
  `resume` pings everything immediately (sleep almost always kills a port-forward). Because
  this happens without the user asking, `store.ts` toasts the drop, the recovery and the
  final give-up — don't make recovery silent.
- **Filters are per column, `op` + value** (`ColumnFilter`), AND- or OR-combined via
  `filterJoin`. Text ops (`contains`/`startsWith`/…) cast the column to text so they work on
  any type; comparison ops (`eq`/`gt`/`in`/…) bind the value untyped so the DB coerces it to
  the column type and numbers/dates order correctly. Adding an op means a case in *both*
  drivers' `buildWhere` plus an entry in `FILTER_OPS` (utils).
- **The right rail holds one panel at a time** — `StructurePanel` (columns, indexes, foreign
  keys, copyable DDL) or `RowDetailPanel` (the selected row, one field per line, JSON pretty-
  printed). Toggled by icon-only toolbar buttons and ⌘⇧E; `.grid-with-rail` is the flex row
  that holds the grid beside it. `StructurePanel` is presentational: `TableTabView` fetches
  the structure because it needs the foreign keys for the grid regardless.
- **⌘↵ runs one statement, ⌘⇧↵ runs the editor.** `sql/statements.ts` is pure (quote-,
  comment- and dollar-quote-aware splitting); `SqlEditor` reports the caret via
  `onSelectionChange` and parents keep it in a **ref**, since `onRun` reads it synchronously.
  A selection always wins over the caret. Explain wraps via `shared/explain.ts`, which only
  uses `ANALYZE` (it executes!) for a plain `SELECT`; a single-column plan renders as `<pre>`,
  MySQL's tabular EXPLAIN stays in the grid.
- **Workspaces scope connections.** Every `ConnectionConfig` has a `workspaceId`; exactly one
  workspace is active (`workspaces.json`) and `connections:list` defaults to it, so the sidebar
  only ever shows the active workspace. No workspace is ever created implicitly — with none,
  `activeWorkspaceId` is null and `WorkspaceBar` opens a non-dismissable `WorkspaceDialog`. The
  one exception is `initStores()` (main entry, before the window opens): if connections predate
  workspaces it makes a "Default" workspace to hold them. Deleting a workspace deletes its
  connections; `workspaceId` is not part of `ConnectionExport`.
- **Query history is per connection**, not per tab or table: everything (console runs,
  query tabs, grid edits) is recorded under `historyKey(connectionId)` and read back from
  the console's History button — the only place it is shown. It persists in
  `query-history.json`; pinned entries sort first, survive the 100-entry cap and "clear",
  and can be named (there is no separate "saved queries" feature).
- **Electron has no `window.prompt`/`confirm`/`alert` in this app** — `window.prompt` throws, and
  the others are banned because they block. Use `Modal` and its wrappers: `ConfirmDialog`,
  `NameQueryDialog`, `WorkspaceDialog`.
- **The title bar is renderer-drawn** (`TitleBar.tsx`, `titleBarStyle: 'hidden'`). Keep
  `--titlebar-h` in `styles.css` in sync with `TITLE_BAR_HEIGHT` in `main/index.ts`, and keep
  `-webkit-app-region: drag` on the bar (add `no-drag` to anything clickable put there). macOS
  shows the traffic lights over it (`trafficLightPosition` + the `.titlebar.mac` left padding).
- **Grid rows are arrays** (`unknown[][]`) aligned to `columns`; primary-key values are read
  by column index. Editing needs a PK — `TableData.editable` gates it. Selection is a
  rectangular block (anchor + far corner) extended by drag, shift-click or shift-arrows;
  ⌘C copies it as TSV **with a header row of the selected column names** and must never open
  the cell editor (the editor only opens on Enter/F2/double-click/a bare printable key). A
  cell whose column has a single-column FK grows a follow button on hover, which opens the
  referenced table filtered to that row (composite FKs are skipped — one cell can't express
  a multi-column match). Following a key re-points the table's existing tab via
  `TableTab.initialFilters` rather than opening a second one.
- **SQL autocomplete lives in `renderer/src/sql/`** — `complete.ts` is pure (context from the
  clause keyword before the caret, `alias.`/`schema.` qualifiers, columns scoped to the
  statement's FROM/JOIN, prefix > part > subsequence ranking), `caret.ts` measures the caret
  pixel offset so the popup is anchored to it. `SqlEditor` only opens the popup for a single
  typed character or ⌃Space — never on paste, click, caret move or a programmatic value
  change, all of which close it. The vocabulary comes from `useDbMetadata`.
- **New IPC call:** add to the `Api` interface in `shared/types.ts`, implement the handler in
  `ipc.ts`, and wire it in `preload/index.ts`. Keep all three in sync.
- **Style with the tokens, never raw values.** `styles.css` §1 defines every color, spacing
  (`--space-1..6`), type size (`--text-2xs..lg`), radius (`--r-sm/md/lg/full`), elevation
  (`--shadow-1/2`, `--ring`) and duration (`--dur`, `--dur-fast`, `--ease-out`) the UI is allowed
  to use. A one-off px value means a missing token. Dark-only; UI text is terse and sentence-case.
- **Icons come from `renderer/src/icons.tsx`** — bundled inline SVG (the CSP blocks remote
  assets). No emoji or Unicode glyphs in JSX. Icons are `aria-hidden`, so an icon-only button
  needs its own `aria-label` next to the `title`.
- **One surface per kind of feedback:** `Banner` for an in-place failure, `showToast` for the
  outcome of a write, `Skeleton` for a first load, `LoadingOverlay` for a refetch over data that
  is already on screen, `EmptyState` for "nothing here yet".

## Notes

- `out/` is build output (gitignored); the Electron binary downloads lazily on first run.
- App icon lives in `resources/` (`icon.png` 1024², `icon.icns`, `icon.ico`) and is loaded by
  `main/index.ts` (BrowserWindow `icon` + `app.dock.setIcon` for unpackaged macOS runs).
- Pre-connection scripts run in the user's shell with full env — treat connection files as
  trusted input.
