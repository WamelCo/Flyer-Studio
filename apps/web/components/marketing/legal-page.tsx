import type { ReactNode } from "react";

/** Long-form legal text: a narrow measure, generous rhythm, quiet headings. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto flex max-w-(--prose-max) flex-col gap-10 px-6 py-20">
      <header className="flex flex-col gap-3">
        <h1 className="text-section text-fg">{title}</h1>
        <p className="text-callout text-fg-secondary">Last updated {updated}</p>
      </header>
      <div className="flex flex-col gap-8 text-body text-fg [&_h2]:text-title [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_p]:text-fg-secondary [&_section]:flex [&_section]:flex-col [&_section]:gap-3 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:text-fg-secondary">
        {children}
      </div>
    </article>
  );
}

/** The support address, when the operator has set NEXT_PUBLIC_SUPPORT_EMAIL. */
export function Contact({ children }: { children: (email: string) => ReactNode }) {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return email ? <>{children(email)}</> : null;
}
