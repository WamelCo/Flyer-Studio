import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-large-title text-fg">{title}</h1>
        {description && <p className="text-body text-fg-secondary">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
