<h1 align="center">🗄️ Hopper</h1>

<p align="center">
  <em>A desktop database client for databases that are a little hard to reach.</em>
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-2b2e3a?logo=electron&logoColor=9feaf9">
  <img alt="React" src="https://img.shields.io/badge/React-2b2e3a?logo=react&logoColor=61dafb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-2b2e3a?logo=typescript&logoColor=3178c6">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-2b2e3a?logo=postgresql&logoColor=4169e1">
  <img alt="MySQL" src="https://img.shields.io/badge/MySQL-2b2e3a?logo=mysql&logoColor=00758f">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2b2e3a">
</p>

---

Most database GUIs assume your database is just… *there*. Mine never is. It sits behind a
`kubectl port-forward`, or an SSH hop into a devcontainer.

So this one runs **your pre-connection script for you**, waits until it's actually ready,
and only then opens the connection.

The UI is deliberately simple. It's built for the everyday administrative stuff (running
selects, updating a few rows, dumping a table to `.csv`), not for being a full-blown IDE.

## ✨ What it does

🔌 **Connects through anything.** Give a connection a bash script and a "ready" regex. The
script runs in its own process group, output streams to a live console, and the app waits
for the match (or a timeout) before dialing the DB. Two friendlier presets, `kubectl` and
`ssh-devcontainer`, generate that script from a few fields and pick a **fresh free local
port on every connect**, so nothing ever clashes and two connections can be live at once.

💚 **Heals itself.** Tunnel died? Laptop slept? A 20s health-check notices, and the
connection retries with backoff, re-running the pre-script and grabbing a new port each
attempt. You get a toast, not a mystery.

🌳 **Browses your schema.** Schemas → tables & views in the sidebar, with a right rail that
shows columns, indexes, foreign keys and copy-pasteable DDL.

📊 **Edits like a spreadsheet.** Click a cell, type, done, written back as a
primary-key-targeted, parameterized `UPDATE`. Insert and delete rows, drag out a rectangular
selection, ⌘C it as TSV (header row included). Cells with a foreign key grow a little follow
button that jumps you to the referenced row. No primary key? The grid stays read-only, on
purpose.

⌨️ **Speaks SQL.** Query tabs with autocomplete (tables, columns, aliases, scoped to your
`FROM`), ⌘↵ to run the statement under the caret, ⌘⇧↵ for the whole editor, and a one-click
`EXPLAIN`.

🗂️ **Keeps things tidy.** Workspaces group connections, per-connection query history is
pinnable and nameable, and there's a **read-only** toggle for the connections you'd rather
not break. Plus pagination, sorting, per-column filters, CSV export, color tags and a
latency-reporting connection test.

🔐 **Keeps secrets secret.** Passwords are encrypted at rest with the OS keychain
(Electron `safeStorage`) and never cross into the renderer.

## 🧰 Tech

- **Electron main** (Node) with `pg` and `mysql2` behind one small `Driver` interface
  (`src/main/db`). Adding an engine means implementing that interface.
- **Typed IPC** over a `contextBridge` preload (`window.api`), `contextIsolation` on.
- **React + Zustand** renderer with a hand-rolled data grid, no heavyweight grid dependency.

## 🚀 Develop

```bash
npm install
npm run dev        # Electron window with HMR
npm run typecheck  # tsc for main+preload and renderer
npm run build      # production build into out/
```

Need something to point it at? There are two throwaway seeded databases in `docker/`:

```bash
npm run testdb:up     # postgres on :55432, mysql on :33060 (demo/demo)
npm run testdb:down
```

## 📦 Build a macOS app

```bash
npm run build:mac  # -> dist/Hopper-<version>-arm64.dmg
```

Ad-hoc signed (no Apple Developer ID), so the build only runs on the machine that made it.

## 🗺️ Layout

```
src/
  main/       Electron main: ipc, stores, pre-script runner, DB drivers
  preload/    contextBridge API surface (window.api)
  shared/     types shared across main/preload/renderer
  renderer/   React UI (components, zustand store, styles)
```

## 🛡️ Security notes

- Passwords never reach the renderer (only `hasPassword`) and are never logged.
- All SQL uses bound parameters; identifiers are quoted per driver.
- Pre-connection scripts run in **your** shell with **your** environment, so treat saved
  connection files as trusted input.

## 📄 License

MIT - see [LICENSE](LICENSE).
