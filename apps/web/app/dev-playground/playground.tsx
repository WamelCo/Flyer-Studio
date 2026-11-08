"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { GeneratingFrame, ResultFrame } from "@/components/create/generation-stage";
import { ViewerProvider } from "@/components/providers/viewer-provider";
import { ShellProvider } from "@/components/shell/shell-provider";
import { Sidebar } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import type { GenerateResponse } from "@flyer/core/api/contracts";

const Editor = dynamic(() => import("@/components/canvas/editor/editor"), { ssr: false });

function Generation({ result }: { result: GenerateResponse }) {
  const [phase, setPhase] = useState<"generating" | "done">(() => (new URLSearchParams(location.search).get("phase") === "done" ? "done" : "generating"));
  const [selected, setSelected] = useState(0);
  return (
    <div className="flex flex-1 flex-col items-center gap-6 p-8">
      <Button onClick={() => setPhase(phase === "done" ? "generating" : "done")}>Toggle phase ({phase})</Button>
      {phase === "generating" ? (
        <GeneratingFrame format="poster" />
      ) : (
        <ResultFrame result={result} selected={selected} onSelect={setSelected} onMainReady={() => undefined} actions={<Button>Open in editor</Button>} />
      )}
    </div>
  );
}

export default function Playground({ result }: { result: GenerateResponse }) {
  const [mode, setMode] = useState<"generation" | "editor">(() => (new URLSearchParams(location.search).get("mode") === "editor" ? "editor" : "generation"));
  const doc = result.docs[0]!;
  const project = { id: result.projectId, title: "Playground flyer", doc, savedDoc: doc, artwork: [] };

  return (
    <ViewerProvider initialViewer={{ id: "dev-user", email: "dev@example.test", plan: "free", credits: 3 }}>
      {mode === "editor" ? (
        <Editor project={project} />
      ) : (
        <ShellProvider initialCollapsed={false}>
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex flex-1 flex-col">
              <div className="p-4">
                <Button variant="secondary" onClick={() => setMode("editor")}>
                  Open editor
                </Button>
              </div>
              <Generation result={result} />
            </div>
          </div>
        </ShellProvider>
      )}
    </ViewerProvider>
  );
}
