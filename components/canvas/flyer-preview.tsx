"use client";

import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Group, Layer, Rect, Stage } from "react-konva";

import { NodeView } from "@/components/canvas/flyer-nodes";
import { loadFonts } from "@/lib/canvas/fonts";
import type { FlyerDoc } from "@/lib/canvas/types";
import { preloadImages } from "@/lib/canvas/use-image";
import { useElementSize } from "@/lib/use-element-size";

interface FlyerPreviewProps {
  doc: FlyerDoc;
  className?: string;
  /** Fires once fonts and images are in, so callers can reveal a fully drawn flyer. */
  onReady?: (page: Konva.Group) => void;
}

/** Read-only render of a flyer document, scaled to its container width. */
export default function FlyerPreview({ doc, className, onReady }: FlyerPreviewProps) {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>();
  const pageRef = useRef<Konva.Group>(null);
  const [assetsReady, setAssetsReady] = useState(false);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    const images = doc.nodes.flatMap((node) => (node.type === "image" ? [node.src] : []));
    Promise.all([loadFonts(doc), preloadImages(images)]).then(() => {
      if (!cancelled) setAssetsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    if (!assetsReady || width === 0 || !pageRef.current) return;
    const page = pageRef.current;
    // One frame so Konva has painted with the loaded faces before anyone snapshots it.
    const frame = requestAnimationFrame(() => onReadyRef.current?.(page));
    return () => cancelAnimationFrame(frame);
  }, [assetsReady, width]);

  const scale = width / doc.width;

  return (
    <div ref={containerRef} className={className} style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
      {width > 0 && (
        <Stage width={width} height={doc.height * scale} scaleX={scale} scaleY={scale} listening={false}>
          <Layer>
            <Group ref={pageRef} clipX={0} clipY={0} clipWidth={doc.width} clipHeight={doc.height}>
              <Rect width={doc.width} height={doc.height} fill={doc.background} />
              {assetsReady && doc.nodes.map((node) => <NodeView key={node.id} node={node} />)}
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  );
}
