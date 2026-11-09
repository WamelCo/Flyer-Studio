"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { EditorProject } from "@/components/canvas/editor/editor";
import { readDraft } from "@/components/canvas/editor/use-autosave";
import { EditorSkeleton } from "@/components/canvas/editor/editor-skeleton";
import type { FlyerDoc } from "@flyer/design/canvas/types";

// Konva is browser-only and heavy; it loads with the editor route, never on the server.
const Editor = dynamic(() => import("@/components/canvas/editor/editor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

interface EditorLoaderProps {
  id: string;
  title: string;
  doc: FlyerDoc;
  updatedAt: string;
  artwork: string[];
}

export function EditorLoader({ id, title, doc, updatedAt, artwork }: EditorLoaderProps) {
  // Prefer a local draft newer than the server copy (e.g. a refresh before the last save landed).
  const [project] = useState<EditorProject>(() => {
    const draft = typeof window === "undefined" ? null : readDraft(id);
    const restored = draft && draft.at > new Date(updatedAt).getTime() ? draft.doc : null;
    return { id, title, doc: restored ?? doc, savedDoc: doc, artwork };
  });

  return <Editor project={project} />;
}
