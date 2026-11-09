"use client";

import { useCallback, useMemo, useReducer } from "react";

import type { FlyerDoc } from "@flyer/design/canvas/types";

/** .claude/rules/canvas-editor.md: 100 undo steps (raised from 20; see docs/ROADMAP.md). */
export const HISTORY_LIMIT = 100;
/** Edits sharing a coalesce key within this window become one undo step (typing, nudging, colour drags). */
const COALESCE_MS = 800;

interface EditorState {
  doc: FlyerDoc;
  past: FlyerDoc[];
  future: FlyerDoc[];
  selectedId: string | null;
  coalesce: { key: string; at: number } | null;
}

type Action =
  | { type: "commit"; doc: FlyerDoc; coalesce?: string; select?: string | null; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; id: string | null };

function keepSelection(doc: FlyerDoc, id: string | null) {
  return id && doc.nodes.some((node) => node.id === id) ? id : null;
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "commit": {
      if (action.doc === state.doc) return state;
      const merge =
        action.coalesce !== undefined &&
        state.coalesce?.key === action.coalesce &&
        action.at - state.coalesce.at < COALESCE_MS;
      return {
        doc: action.doc,
        past: merge ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        selectedId: keepSelection(action.doc, action.select !== undefined ? action.select : state.selectedId),
        coalesce: action.coalesce ? { key: action.coalesce, at: action.at } : null,
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
        selectedId: keepSelection(previous, state.selectedId),
        coalesce: null,
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return {
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future,
        selectedId: keepSelection(next, state.selectedId),
        coalesce: null,
      };
    }
    case "select":
      return state.selectedId === action.id ? state : { ...state, selectedId: action.id, coalesce: null };
  }
}

/** Snapshot history: undo/redo swap whole documents, so they are instant. */
export function useEditorState(initialDoc: FlyerDoc) {
  const [state, dispatch] = useReducer(reducer, {
    doc: initialDoc,
    past: [],
    future: [],
    selectedId: null,
    coalesce: null,
  });

  const commit = useCallback(
    (doc: FlyerDoc, options?: { coalesce?: string; select?: string | null }) =>
      dispatch({ type: "commit", doc, at: performance.now(), ...options }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const select = useCallback((id: string | null) => dispatch({ type: "select", id }), []);

  const selected = useMemo(
    () => state.doc.nodes.find((node) => node.id === state.selectedId) ?? null,
    [state.doc, state.selectedId],
  );

  return {
    doc: state.doc,
    selected,
    selectedId: state.selectedId,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    undo,
    redo,
    select,
  };
}

export type EditorApi = ReturnType<typeof useEditorState>;
