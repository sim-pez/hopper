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
                    connectionStore (CRUD), secrets (keychain).
    process/        preScriptRunner — spawns/tracks/kills pre-connection scripts.
    db/             Driver interface (types.ts) + postgres.ts + mysql.ts + pool.ts
                    (connection registry, orchestrates pre-script -> connect).
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
- **Grid rows are arrays** (`unknown[][]`) aligned to `columns`; primary-key values are read
  by column index. Editing needs a PK — `TableData.editable` gates it.
- **New IPC call:** add to the `Api` interface in `shared/types.ts`, implement the handler in
  `ipc.ts`, and wire it in `preload/index.ts`. Keep all three in sync.
- Match the existing dark theme in `styles.css` (CSS variables at `:root`); UI text is terse.

## Notes

- Not a git repo yet.
- `out/` is build output (gitignored); the Electron binary downloads lazily on first run.
- App icon lives in `resources/` (`icon.png` 1024², `icon.icns`, `icon.ico`) and is loaded by
  `main/index.ts` (BrowserWindow `icon` + `app.dock.setIcon` for unpackaged macOS runs).
- Pre-connection scripts run in the user's shell with full env — treat connection files as
  trusted input.
