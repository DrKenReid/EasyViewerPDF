# EasyViewerPDF

A deliberately simple desktop app: open a PDF, it splits into individual pages,
and you view multiple pages side by side in a fully malleable grid.

Built with Electron + [pdf.js](https://mozilla.github.io/pdf.js/). Dark mode
native, keyboard accessible, and easy to maintain.

## Features

- **Library of views** — the home screen shows your saved views. The first tile
  is a `+` that creates a new one from a PDF.
- **Quick file access** — right-click a view to copy the path to the stored
  PDF copy.
- **Drag to categorize** — drag a view onto a category section to move it.
- **Safe storage** — when you create a view, the chosen PDF is copied into the
  app's per-user data folder, so the view keeps working even if you move or
  delete the original.
- **Malleable grid** — adjust the number of **columns** and **rows on screen**
  with the toolbar steppers (`[` / `]` shortcuts for columns).
- **Malleable size** — resize an individual page by dragging the blue corner
  handle. Hold **Ctrl** while dragging to resize *all* pages together. The
  **Size** slider (or `Ctrl` `+` / `Ctrl` `-`) scales the whole group.
- **Lazy rendering** — pages render as they scroll into view, so large PDFs stay
  responsive.

## Run it

```powershell
npm install
npm start
```

## Build a Windows installer

```powershell
npm install
npm run dist:win
```

The installer is written to `dist/` as a setup `.exe`. For future releases,
update the app version in `package.json` and rerun the same command.

## Where files live

Views are stored under your per-user app data folder:

```
<userData>/library/<viewId>/
  source.pdf   # the safely-copied original
  view.json    # name + layout (columns, rows, size, per-page overrides)
```

Use **Open storage folder** on the library screen to reveal it. On Windows this
is typically `%APPDATA%/easyviewerpdf/library`.

## Project layout

| File | Responsibility |
|------|----------------|
| `main.js` | Electron main process + file-system backed library (IPC). |
| `preload.js` | Secure `window.api` bridge. |
| `renderer/app.js` | Routing between library and viewer. |
| `renderer/library.js` | Library screen and thumbnails. |
| `renderer/viewer.js` | Page grid, resizing, row/column controls. |
| `renderer/pdfutil.js` | pdf.js wrapper (load + render page). |
| `renderer/ui.js` | Accessible modal confirm/prompt dialogs. |
| `renderer/dom.js` | Small DOM helpers. |
| `renderer/styles.css` | Dark, accessible theme. |
```
