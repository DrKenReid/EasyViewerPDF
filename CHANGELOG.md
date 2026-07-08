# Changelog

All notable changes to EasyViewerPDF are documented here.

## Unreleased

- Clarified the license: the project is now consistently MIT everywhere
  (LICENSE, package metadata, README, and the in-app footer previously
  disagreed).
- Fixed library keyboard shortcuts (Ctrl+N/E/I/F) staying active inside the
  viewer.
- Pressing Delete in selection mode now asks for confirmation and only deletes
  visible selections, matching the bulk-bar button.
- Hardened IPC: view ids from the renderer are validated as UUIDs before being
  used in filesystem paths.
- Toasts are announced to screen readers, and context menus support arrow-key
  navigation.
- Added unit tests (`npm test`), a syntax check (`npm run lint`), and GitHub
  Actions workflows for CI and tagged releases.
- Installer builds are no longer tracked in git; download them from GitHub
  Releases.

## 1.0.1 — 2026-06-19

- Added a multi-tag system replacing single categories, with tag colors,
  reordering, and migration of existing libraries.
- Added collapsible library sections and configurable section ordering.
- Added metadata export/import.
- Reduced the Windows installer from 94 MB to 79 MB.

## 1.0.0 — 2026-06-02

- Initial release: PDF library with copied storage, categories, search and
  sort, multi-select bulk actions, drag-and-drop import, and a flexible
  side-by-side page grid viewer with per-page and group resizing.
