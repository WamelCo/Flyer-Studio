"use client";

import { Reorder } from "framer-motion";
import { Eye, EyeOff, Image as ImageIcon, Lock, PenTool, Search, Shapes, Type, Unlock, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { InlineMessage } from "@/components/ui/inline-message";
import { inputClassName } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { FONT_FAMILIES, FONT_KEYS, FONT_LABELS } from "@/lib/canvas/fonts";
import {
  createIcon,
  createImage,
  createRing,
  createShape,
  createStar,
  createText,
  describeNode,
  ICON_LIBRARY,
  reorderNodes,
  updateNode,
  type ShapePreset,
  type TextPreset,
} from "@/lib/canvas/ops";
import type { FlyerDoc, FlyerNode, ImageNode } from "@flyer/core/canvas/types";
import ICONS from "@flyer/core/design/icons.json";
import { UploadError, uploadImage } from "@/lib/canvas/upload";
import { useImage } from "@/lib/canvas/use-image";
import { cn } from "@/lib/utils";

interface PanelProps {
  doc: FlyerDoc;
  onAdd: (node: FlyerNode) => void;
}

const tileClass = "focus-ring flex w-full items-center rounded-control bg-surface px-4 text-left text-fg shadow-card hover:bg-fill";

export function TextPanel({ doc, onAdd }: PanelProps) {
  const presets: { preset: TextPreset; label: string; className: string }[] = [
    { preset: "heading", label: "Add a heading", className: "h-14 text-title" },
    { preset: "subheading", label: "Add a subheading", className: "h-12 text-headline" },
    { preset: "body", label: "Add body text", className: "h-12 text-callout" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {presets.map(({ preset, label, className }) => (
          <button key={preset} type="button" className={cn(tileClass, className)} onClick={() => onAdd(createText(doc, preset))}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-fg-secondary">Typefaces</span>
        <div className="grid grid-cols-2 gap-2">
          {FONT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onAdd(createText(doc, "subheading", key))}
              className="focus-ring h-12 truncate rounded-control bg-fill px-3 text-headline text-fg hover:bg-fill-strong"
              style={{ fontFamily: FONT_FAMILIES[key] }}
            >
              {FONT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtworkTile({ src, onPick }: { src: string; onPick: (image: HTMLImageElement) => void }) {
  const image = useImage(src);
  return (
    <button
      type="button"
      disabled={!image}
      onClick={() => image && onPick(image)}
      aria-label="Add this artwork"
      className="focus-ring relative aspect-square overflow-hidden rounded-control bg-fill"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- already decoded by the canvas image cache
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <Skeleton className="absolute inset-0" />
      )}
    </button>
  );
}

interface StockResult {
  url: string;
  thumb: string;
  width: number;
  height: number;
  credit: { name: string; url: string };
  downloadLocation: string;
}

interface ImagePanelProps extends PanelProps {
  artwork: string[];
  /** With a photo frame selected, picks replace its photo instead of adding a new one. */
  selectedImage: ImageNode | null;
  onReplace: (src: string, credit?: ImageNode["credit"]) => void;
}

export function ImagePanel({ doc, onAdd, artwork, selectedImage, onReplace }: ImagePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<StockResult[]>([]);

  function place(src: string, size: { width: number; height: number }, credit?: ImageNode["credit"]) {
    if (selectedImage) return onReplace(src, credit);
    const node = createImage(doc, src, size);
    onAdd(credit ? { ...node, credit } : node);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadImage(file);
      place(uploaded.url, uploaded);
    } catch (caught) {
      setError(caught instanceof UploadError ? caught.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const { photos } = await apiFetch<{ photos: StockResult[] }>(`/api/photos?query=${encodeURIComponent(query.trim())}&format=${doc.format}`);
      setResults(photos);
      if (!photos.length) setError("No photos found. Try a broader search.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Photo search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  function pickStock(photo: StockResult) {
    place(photo.url, photo, photo.credit);
    void apiFetch("/api/photos/track", { method: "POST", json: { downloadLocation: photo.downloadLocation } }).catch(() => undefined);
  }

  const used = doc.nodes.flatMap((node) => (node.type === "image" && node.src ? [node.src] : []));
  const library = [...new Set([...artwork, ...used])];

  return (
    <div className="flex flex-col gap-4">
      {selectedImage && <p className="text-caption text-fg-secondary">Pick a photo to place it in the selected frame.</p>}
      <form onSubmit={search} className="relative" role="search">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-secondary" />
        <input
          aria-label="Search stock photos"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search photos"
          className={cn(inputClassName, "h-10 pl-9 text-callout")}
        />
      </form>
      {(searching || results.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            {searching
              ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-control" />)
              : results.map((photo) => (
                  <button
                    key={photo.url}
                    type="button"
                    onClick={() => pickStock(photo)}
                    aria-label={`Photo by ${photo.credit.name}`}
                    title={`Photo by ${photo.credit.name} on Unsplash`}
                    className="focus-ring relative aspect-square overflow-hidden rounded-control bg-fill"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from Unsplash */}
                    <img src={photo.thumb} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                ))}
          </div>
          {!searching && <span className="text-caption text-fg-secondary">Photos from Unsplash</span>}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className={cn(tileClass, "h-12 gap-3")}>
        <Upload className="size-4 text-accent-text" />
        <span className="text-callout font-medium">{uploading ? "Uploading…" : "Upload your own"}</span>
      </button>
      <InlineMessage>{error}</InlineMessage>
      {(library.length > 0 || uploading) && (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-fg-secondary">In this design</span>
          <div className="grid grid-cols-3 gap-2">
            {uploading && <Skeleton className="aspect-square rounded-control" />}
            {library.map((src) => (
              <ArtworkTile key={src} src={src} onPick={(image) => place(src, { width: image.naturalWidth, height: image.naturalHeight })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SWATCHES = ["#0071E3", "#1D1D1F", "#FFFFFF", "#FF3B30", "#FF9500", "#FFD60A", "#34C759", "#AF52DE"];

export function ShapePanel({ doc, onAdd }: PanelProps) {
  const [color, setColor] = useState(SWATCHES[0]!);
  const shapes: { preset: ShapePreset; label: string; preview: string }[] = [
    { preset: "rect", label: "Rectangle", preview: "rounded-none" },
    { preset: "rounded", label: "Rounded", preview: "rounded-button" },
    { preset: "ellipse", label: "Ellipse", preview: "rounded-full" },
    { preset: "line", label: "Line", preview: "h-1" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {shapes.map(({ preset, label, preview }) => (
          <button
            key={preset}
            type="button"
            onClick={() => onAdd(createShape(doc, preset, color))}
            className="focus-ring flex h-20 flex-col items-center justify-center gap-2 rounded-control bg-surface shadow-card hover:bg-fill"
          >
            <span className={cn("block w-8", preset === "line" ? preview : cn("h-8", preview))} style={{ background: color }} />
            <span className="text-caption text-fg-secondary">{label}</span>
          </button>
        ))}
        <button type="button" onClick={() => onAdd(createRing(doc, color))} className="focus-ring flex h-20 flex-col items-center justify-center gap-2 rounded-control bg-surface shadow-card hover:bg-fill">
          <span className="block size-8 rounded-full border-4" style={{ borderColor: color, borderBottomColor: "transparent" }} />
          <span className="text-caption text-fg-secondary">Ring</span>
        </button>
        {(["star", "burst"] as const).map((kind) => (
          <button key={kind} type="button" onClick={() => onAdd(createStar(doc, kind, color))} className="focus-ring flex h-20 flex-col items-center justify-center gap-2 rounded-control bg-surface shadow-card hover:bg-fill">
            <svg viewBox="0 0 100 100" className="size-8" aria-hidden>
              <path d={createStar(doc, kind).paths[0]} fill={color} />
            </svg>
            <span className="text-caption text-fg-secondary">{kind === "star" ? "Star" : "Burst"}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-fg-secondary">Colour</span>
        <div role="radiogroup" aria-label="Shape colour" className="flex flex-wrap gap-2">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={swatch === color}
              aria-label={swatch}
              onClick={() => setColor(swatch)}
              className={cn(
                "focus-ring size-8 rounded-full shadow-card",
                swatch === color && "ring-2 ring-accent ring-offset-2 ring-offset-base",
              )}
              style={{ background: swatch }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-fg-secondary">Icons</span>
        <div className="grid grid-cols-6 gap-1">
          {ICON_LIBRARY.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onAdd(createIcon(doc, name, color))}
              aria-label={`${name} icon`}
              title={name}
              className="focus-ring inline-flex aspect-square items-center justify-center rounded-button text-fg hover:bg-fill"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {ICONS[name].map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const TYPE_ICONS = { text: Type, image: ImageIcon, shape: Shapes, path: PenTool } as const;

interface LayersPanelProps {
  doc: FlyerDoc;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCommit: (doc: FlyerDoc, coalesce?: string) => void;
}

/** Top of the list = front-most. Drag rows to change z-order. */
export function LayersPanel({ doc, selectedId, onSelect, onCommit }: LayersPanelProps) {
  const topToBottom = [...doc.nodes].reverse();
  const [order, setOrder] = useState<string[] | null>(null);
  const ids = order ?? topToBottom.map((node) => node.id);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));

  return (
    <div className="flex flex-col gap-4">
      <Reorder.Group
        axis="y"
        values={ids}
        onReorder={setOrder}
        className="flex flex-col gap-1"
        aria-label="Layers"
      >
        {ids.map((id) => {
          const node = byId.get(id);
          if (!node) return null;
          const Icon = TYPE_ICONS[node.type];
          const selected = id === selectedId;
          return (
            <Reorder.Item
              key={id}
              value={id}
              onDragEnd={() => {
                if (order) onCommit(reorderNodes(doc, order));
                setOrder(null);
              }}
              className={cn(
                "flex h-11 cursor-grab items-center gap-2 rounded-button px-2 active:cursor-grabbing",
                selected ? "bg-accent-soft" : "hover:bg-fill",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-button text-left"
              >
                <Icon className="size-4 shrink-0 text-fg-secondary" />
                <span className={cn("truncate text-callout", node.hidden ? "text-fg-secondary" : "text-fg")}>
                  {describeNode(node)}
                </span>
              </button>
              <button
                type="button"
                aria-label={node.hidden ? "Show layer" : "Hide layer"}
                onClick={() => onCommit(updateNode(doc, id, { hidden: !node.hidden }))}
                className="focus-ring inline-flex size-8 items-center justify-center rounded-button text-fg-secondary hover:text-fg"
              >
                {node.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button
                type="button"
                aria-label={node.locked ? "Unlock layer" : "Lock layer"}
                onClick={() => onCommit(updateNode(doc, id, { locked: !node.locked }))}
                className="focus-ring inline-flex size-8 items-center justify-center rounded-button text-fg-secondary hover:text-fg"
              >
                {node.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
              </button>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      <label className="flex h-11 items-center justify-between gap-3 rounded-button px-2 hover:bg-fill">
        <span className="text-callout text-fg">Page colour</span>
        <span className="relative inline-flex size-8 items-center justify-center">
          <span className="size-6 rounded-full shadow-card" style={{ background: doc.background }} />
          <input
            type="color"
            aria-label="Page colour"
            value={/^#[0-9a-f]{6}$/i.test(doc.background) ? doc.background : "#ffffff"}
            onChange={(event) => onCommit({ ...doc, background: event.target.value }, "page-background")}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </span>
      </label>
    </div>
  );
}
