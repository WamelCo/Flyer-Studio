"use client";

import dynamic from "next/dynamic";

import type { GenerateResponse } from "@/lib/api/contracts";

// Client-only: the harness reads the URL and mounts Konva at load.
const Playground = dynamic(() => import("./playground"), { ssr: false });

export function PlaygroundLoader({ result }: { result: GenerateResponse }) {
  return <Playground result={result} />;
}
