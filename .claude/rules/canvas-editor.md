# Flyer Canvas Editor Rules

## Technology
- Use `fabric.js` or `konva.js` for the canvas. Do not build a DOM-based editor.

## Features Required
- Drag-and-drop text, images, shapes.
- Inline text editing (double-click).
- Layer panel (z-index reordering).
- Undo/Redo (history stack, 100 steps — `HISTORY_LIMIT` in `use-editor-state.ts`).
- Planned editor parity (magic resize, multi-select, smart guides, brand kits, QR codes, version
  history, comments): see Phase 2 in `docs/ROADMAP.md`.
- Export current canvas state as JSON to Supabase (`flyer_projects` table).

## Persistence
- Auto-save every 30 seconds. Use debounced saves. Do not save on every pixel movement.