# Flyer Canvas Editor Rules

## Technology
- Use `fabric.js` or `konva.js` for the canvas. Do not build a DOM-based editor.

## Features Required
- Drag-and-drop text, images, shapes.
- Inline text editing (double-click).
- Layer panel (z-index reordering).
- Undo/Redo (history stack, max 20 steps).
- Export current canvas state as JSON to the API (`PATCH /api/projects/:id` → Postgres `flyer_projects` table).

## Persistence
- Auto-save every 30 seconds. Use debounced saves. Do not save on every pixel movement.