# DB Manager

A desktop database client (Electron + React + TypeScript) built for databases that are
only reachable after running a **pre-connection script** — e.g. a `kubectl port-forward`
into a cluster.

## Features

- **Saved connections** for PostgreSQL and MySQL/MariaDB. Passwords are encrypted at rest
  with the OS keychain (Electron `safeStorage`); connection metadata lives in JSON under
  the app's `userData` dir.
- **Per-connection pre-connection bash script.** On *Connect* the script is spawned (in its
  own process group), its output streamed to a live console, and the app waits until a
  configurable "ready" regex matches (or a timeout elapses) before opening the DB. On
  *Disconnect* / quit the whole process group is terminated so port-forwards don't leak.
- **Schema browser** — expand schemas → tables/views in the sidebar.
- **Excel-like editable grid.** Double-click (or press Enter/F2) a cell to edit; the change
  is written back as a primary-key-targeted, parameterized `UPDATE`. Insert and delete rows
  too. Editing needs a primary key — otherwise the grid is read-only.
- **SQL query tab** with a results grid (⌘/Ctrl+Enter to run).
- **Extras:** pagination + adjustable `LIMIT`, column sort, CSV export, connection test with
  latency, per-connection color tags, duplicate, and a **read-only** safety toggle for prod.

## Tech

- Electron main (Node) with `pg` and `mysql2` behind a common `Driver` interface
  (`src/main/db`). Add new engines by implementing that interface.
- Typed IPC via a `contextBridge` preload (`window.api`), `contextIsolation` on.
- React + Zustand renderer, custom lightweight data grid (no heavy grid dependency).

## Develop

```bash
npm install
npm run dev        # launches the Electron window with HMR
npm run typecheck  # tsc for main+preload and renderer
npm run build      # production build into out/
```

## Build a macOS app

```bash
npm run build:mac  # -> dist/DB Manager-<version>-arm64.dmg + dist/mac-arm64/DB Manager.app
```

Ad-hoc signed (no Apple Developer ID), so the build only runs on the machine that made it.

## Layout

```
src/
  main/       Electron main: ipc, stores, pre-script runner, DB drivers
  preload/    contextBridge API surface (window.api)
  shared/     types shared across main/preload/renderer
  renderer/   React UI (components, zustand store, styles)
```

## Security notes

- Passwords are never sent to the renderer (only `hasPassword`) and never logged.
- Pre-connection scripts run in your shell with your environment; treat connection files as
  trusted input.
