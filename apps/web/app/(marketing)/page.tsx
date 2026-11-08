import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { demoScenes } from "@/components/marketing/demo-scenes";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { ButtonLink } from "@/components/ui/button";

const STEPS = [
  { title: "Describe it", body: "One sentence — what, where, when. We read the intent and pull out the words that matter." },
  { title: "Pick a direction", body: "Three designs arrive, each with its own layout, palette and type pairing, chosen the way a designer would." },
  { title: "Make it yours", body: "Every shape, word and photo is editable on the canvas. Export print-ready PDF or PNG." },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto grid max-w-(--content-max) items-center gap-12 px-6 py-12 lg:min-h-[calc(100dvh-var(--bar-height))] lg:grid-cols-2">
        <div className="flex flex-col items-start gap-6">
          <h1 className="text-large-title text-fg md:text-balance">Describe it. Get a flyer worth printing.</h1>
          <p className="max-w-(--prose-max) text-body text-fg-secondary">
            Type a sentence about your event, sale or listing. Flyer Studio lays out three designs you can edit and export in
            seconds.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <ButtonLink href="/dashboard" size="lg">
              Start creating
            </ButtonLink>
            <Link
              href="/pricing"
              className="focus-ring inline-flex items-center gap-1 rounded-button text-callout font-medium text-accent-text hover:underline underline-offset-4"
            >
              See pricing
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
        <HeroDemo scenes={demoScenes()} />
      </section>

      <section aria-labelledby="how-heading" className="border-t border-separator">
        <div className="mx-auto flex max-w-(--content-max) flex-col gap-8 px-6 py-12">
          <h2 id="how-heading" className="text-title text-fg">
            From a sentence to print in under a minute.
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-panel bg-surface p-6 shadow-card">
                <span className="text-caption font-semibold text-accent-text">Step {index + 1}</span>
                <span className="text-headline text-fg">{step.title}</span>
                <p className="text-callout text-fg-secondary">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-separator">
        <div className="mx-auto flex max-w-(--content-max) flex-col items-center gap-6 px-6 py-12 text-center">
          <h2 className="text-title text-fg">Your next flyer is one sentence away.</h2>
          <ButtonLink href="/dashboard" size="lg">
            Start creating
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
