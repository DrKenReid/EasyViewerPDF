# Contributing

Thanks for your interest in EasyViewerPDF!

## Getting started

```powershell
npm install
npm start        # run the app
npm test         # unit tests (node:test, no extra dependencies)
npm run lint     # syntax check of all first-party JS
npm run dist:win # build the Windows installer into dist/
```

## Project layout

- `main.js` — Electron main process and the file-system backed library (IPC).
- `preload.js` — the explicit `window.api` bridge.
- `lib/` — pure helpers shared by the main process and unit tests.
- `renderer/` — library and viewer screens (ES modules, no framework).
- `test/` — unit tests, run with `node --test`.

## Guidelines

- Keep the renderer free of Node/Electron APIs; everything crosses the
  preload bridge.
- New pure logic belongs in `lib/` with tests.
- Match the existing code style (2-space indent, single quotes, JSDoc where a
  signature isn't obvious).
- Don't commit build output; `dist/` is ignored and installers are published
  via GitHub Releases.

## Reporting issues

Open an issue at https://github.com/DrKenReid/EasyViewerPDF/issues with steps
to reproduce and your Windows version.
