import { Camera, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { demoScenes } from "@/components/marketing/demo-scenes";
import { Faq, type FaqItem } from "@/components/marketing/faq";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { HtmlFlyer } from "@/components/marketing/html-flyer";
import { Reveal } from "@/components/marketing/reveal";
import { showcase } from "@/components/marketing/showcase";
import { ButtonLink } from "@/components/ui/button";
import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import { ideogramConfigured } from "@flyer/ai/ideogram";
import { PALETTES, type PaletteId } from "@flyer/design/palettes";
import { PLANS } from "@flyer/billing/plans";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Describe it.", body: "What, where and when, in one sentence. Name a colour, a style or the imagery you want — the art director follows it." },
  { title: "Pick a direction.", body: "Three designs arrive in seconds, each with its own layout, colour palette and type pairing." },
  { title: "Make it yours.", body: "Change any word, colour or photo on the canvas, then export a print-ready PDF or a crisp PNG." },
];

const SWATCHES: PaletteId[] = ["luxe-gold", "hot-sale", "estate-navy", "serene-lavender", "neon-party", "harvest-gold"];

export default function LandingPage() {
  const ideogram = ideogramConfigured();
  const examples = showcase();
  const faq: FaqItem[] = [
    {
      question: "Is this AI image generation?",
      answer: ideogram
        ? "Not the kind that hands you a flat picture. An AI art director writes the brief and copy, and every flyer is built from real, editable layers — type, shapes, icons and photo frames. The lead direction's artwork is painted by Ideogram, and its text is lifted off into editable text layers."
        : "No. An AI art director writes the brief and copy, and a layout engine builds every flyer from real, editable layers — type, shapes, icons and photo frames — the way a graphic designer works.",
    },
    {
      question: "Will it make up details like dates or prices?",
      answer: "No. Times, dates, prices, phone numbers and addresses only come from what you typed. Anything the AI adds that you didn't say is removed before the flyer is designed.",
    },
    {
      question: "Can I edit everything?",
      answer: "Yes. Every word, colour, shape and photo is a layer on the canvas: retype it, move it, restyle it, swap the photo for your own, and undo any change.",
    },
    {
      question: "What sizes and files can I export?",
      answer: "Poster (A4), square, 9:16 story and 16:9 landscape, as PNG or PDF. Paid plans add HD 2K and 4K exports without a watermark.",
    },
    {
      question: "Can I use my flyers commercially?",
      answer: "Paid plans include commercial use. Free-plan exports carry a watermark.",
    },
    {
      question: "Does my plan renew automatically?",
      answer: "No. Pro and Max are passes for 1 or 12 months, paid once through Paynow (EcoCash, OneMoney or card). We remind you before a pass ends; renew from Billing, or reply “buy” on WhatsApp. The credits you have are yours to keep.",
    },
  ];

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden px-6 pt-16 pb-20 sm:pt-24">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
          <span className="text-eyebrow text-accent-warm">Flyer Studio</span>
          <h1 className="text-display text-balance text-fg">
            Describe it.
            <br />
            We’ll design it.
          </h1>
          <p className="max-w-2xl text-subtitle text-balance text-fg-secondary">
            One sentence becomes three art-directed flyers — real typography, considered colour, and every word still yours to
            edit. Ready to print or post.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <ButtonLink href="/dashboard" size="lg" shape="capsule">
              Start creating
            </ButtonLink>
            <TextLink href="#examples">See examples</TextLink>
          </div>
        </div>
        <div className="mx-auto mt-16 max-w-xl">
          <HeroDemo scenes={demoScenes()} />
        </div>
      </section>

      {/* ── Examples ─────────────────────────────────────────────────────── */}
      <section id="examples" aria-labelledby="examples-heading" className="scroll-mt-(--bar-height) bg-surface px-6 py-24">
        <div className="mx-auto flex max-w-(--content-max) flex-col gap-14">
          <Reveal className="flex flex-col items-center gap-4 text-center">
            <h2 id="examples-heading" className="text-section text-balance text-fg">
              One sentence. Every style.
            </h2>
            <p className="max-w-2xl text-subtitle text-balance text-fg-secondary">
              Each of these started as the line underneath it. Layout, colour, type and decoration were all chosen to fit.
            </p>
          </Reveal>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
            {examples.map((example, index) => (
              <li key={example.prompt} className={cn(index % 2 === 1 && "lg:translate-y-10")}>
                <Reveal delay={(index % 4) * 0.06} className="flex flex-col gap-4">
                  <div className="overflow-hidden rounded-control shadow-page">
                    <HtmlFlyer doc={example.doc} />
                  </div>
                  <figure className="flex flex-col gap-1">
                    <blockquote className="text-callout text-fg">“{example.prompt}”</blockquote>
                    <figcaption className="text-caption text-fg-secondary">{example.style}</figcaption>
                  </figure>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" aria-labelledby="features-heading" className="scroll-mt-(--bar-height) px-6 py-24">
        <div className="mx-auto flex max-w-(--content-max) flex-col gap-14">
          <Reveal className="flex flex-col items-center gap-4 text-center">
            <h2 id="features-heading" className="text-section text-balance text-fg">
              The thinking of a designer.
              <br className="hidden sm:block" /> The speed of a sentence.
            </h2>
          </Reveal>

          <div className="grid gap-5 lg:grid-cols-6">
            <Tile className="lg:col-span-4" eyebrow="Art direction" title="Colour, type and layout, chosen for your message.">
              <p className="text-body text-fg-secondary">
                Every palette carries a meaning, from trustworthy blues to celebratory neons. Every type pairing has a voice. The art
                director matches both to what you’re saying and who it’s for.
              </p>
              <div className="mt-auto flex flex-col gap-3 pt-4">
                {SWATCHES.map((id) => {
                  const p = PALETTES[id];
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <span className="flex">
                        {[p.primary, p.accent, p.accent2, p.dark, p.bg].map((colour, i) => (
                          <span key={i} className="-ml-1.5 size-6 rounded-full ring-2 ring-surface first:ml-0" style={{ backgroundColor: colour }} />
                        ))}
                      </span>
                      <span className="text-callout text-fg">{p.name}</span>
                      <span className="hidden truncate text-caption text-fg-secondary sm:inline">{p.mood}</span>
                    </div>
                  );
                })}
              </div>
            </Tile>

            <Tile dark className="lg:col-span-2" eyebrow="Facts, not fiction" title="It never invents your details.">
              <p className="text-body text-tile-dark-secondary">
                Times, dates, prices and contact details come only from what you typed. Anything else is removed before a single
                letter is set.
              </p>
              <div className="mt-auto flex flex-col gap-2 pt-6 text-callout">
                <span className="flex items-center gap-2 text-tile-dark-fg">
                  <span className="size-2 rounded-full bg-success" /> Saturday · 2pm
                </span>
                <span className="flex items-center gap-2 text-tile-dark-secondary line-through decoration-danger">
                  <span className="size-2 rounded-full bg-danger" /> Party until 5pm
                </span>
                <span className="flex items-center gap-2 text-tile-dark-secondary line-through decoration-danger">
                  <span className="size-2 rounded-full bg-danger" /> RSVP by Thursday
                </span>
              </div>
            </Tile>

            <Tile className="lg:col-span-2" eyebrow="Typography" title="Set by real font metrics.">
              <p className="text-body text-fg-secondary">
                Headlines are measured letter by letter, so nothing overflows. Every word clears accessible contrast.
              </p>
              <div className="mt-auto flex items-end gap-4 pt-6 text-fg">
                <span className="text-[64px] leading-none" style={{ fontFamily: FONT_FAMILIES.serif }}>
                  Aa
                </span>
                <span className="text-[64px] leading-none" style={{ fontFamily: FONT_FAMILIES.display }}>
                  Aa
                </span>
                <span className="text-[56px] leading-none" style={{ fontFamily: FONT_FAMILIES.calligraphy }}>
                  Aa
                </span>
              </div>
            </Tile>

            <Tile className="lg:col-span-2" eyebrow="Editable canvas" title="Every word stays yours.">
              <p className="text-body text-fg-secondary">
                Retype, move, recolour and resize anything. Swap in your own photo. Undo whenever you like.
              </p>
              <div className="relative mx-auto mt-auto w-36 pt-6">
                <div className="overflow-hidden rounded-button shadow-page">
                  <HtmlFlyer doc={examples[1]!.doc} />
                </div>
                {/* A selection box around the headline, as the editor draws it. */}
                <span aria-hidden className="absolute top-[calc(1.5rem+9%)] left-[5%] h-[25%] w-[66%] rounded-[2px] border-2 border-accent">
                  {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map((corner) => (
                    <span key={corner} className={cn("absolute size-2 rounded-full border-2 border-accent bg-surface", corner)} />
                  ))}
                </span>
              </div>
            </Tile>

            <Tile className="lg:col-span-2" eyebrow="Photography" title="Photos that fit the story.">
              <p className="text-body text-fg-secondary">
                Real stock photography is searched for each design and credited to the photographer. Or drop in your own.
              </p>
              <div className="mt-auto flex flex-col gap-3 pt-6">
                <div className="flex gap-2">
                  {(["ocean-coral", "harvest-gold", "spring-garden"] as const).map((id) => (
                    <span
                      key={id}
                      aria-hidden
                      className="aspect-[4/5] flex-1 rounded-button"
                      style={{ background: `linear-gradient(160deg, ${PALETTES[id].tint}, ${PALETTES[id].primary})` }}
                    />
                  ))}
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-fill px-3 py-1 text-caption text-fg">
                  <Camera aria-hidden className="size-3.5" /> Photographer credited automatically
                </span>
              </div>
            </Tile>

            {ideogram && (
              <Tile dark className="lg:col-span-3" eyebrow="Lead design by Ideogram" title="Illustrated artwork, editable text.">
                <p className="text-body text-tile-dark-secondary">
                  The first direction is painted by Ideogram from the art director’s brief. Its lettering is lifted off and re-set
                  as real text layers, spelled exactly as approved.
                </p>
              </Tile>
            )}

            <Tile className={ideogram ? "lg:col-span-3" : "min-h-0 lg:col-span-6"} eyebrow="Export" title="Print-ready in one click.">
              <p className="text-body text-fg-secondary">
                A4 PDF for the printer, PNG for socials, up to 4K on paid plans. Poster, square, story and landscape sizes.
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                {["A4 PDF", "PNG", "2K", "4K", "1:1", "9:16", "16:9"].map((label) => (
                  <span key={label} className="rounded-full bg-fill px-3 py-1 text-caption font-medium text-fg">
                    {label}
                  </span>
                ))}
              </div>
            </Tile>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-(--bar-height) bg-surface px-6 py-24">
        <div className="mx-auto flex max-w-(--content-max) flex-col gap-14">
          <Reveal className="text-center">
            <h2 id="how-heading" className="text-section text-balance text-fg">
              From a sentence to print in under a minute.
            </h2>
          </Reveal>
          <ol className="grid gap-10 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 0.08} className="flex flex-col gap-3">
                  <span className="text-section text-fg-secondary/40 tabular-nums">{index + 1}</span>
                  <h3 className="text-title text-fg">{step.title}</h3>
                  <p className="text-body text-fg-secondary">{step.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="pricing-heading" className="px-6 py-24">
        <Reveal className="mx-auto flex max-w-(--content-max) flex-col items-center gap-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <h2 id="pricing-heading" className="text-section text-balance text-fg">
              Start free. Upgrade when you’re ready.
            </h2>
            <p className="max-w-2xl text-subtitle text-balance text-fg-secondary">The full editor is free. Plans add monthly credits, HD export and no watermarks.</p>
          </div>
          <div className="grid w-full gap-5 sm:grid-cols-3">
            {(["free", "pro", "max"] as const).map((id) => {
              const plan = PLANS[id];
              return (
                <div key={id} className={cn("flex flex-col items-center gap-2 rounded-tile bg-surface p-8 shadow-card", id === "pro" && "ring-2 ring-accent")}>
                  <span className="text-headline text-fg">{plan.name}</span>
                  <span className="text-section text-fg tabular-nums">${plan.price.month}</span>
                  <span className="text-caption text-fg-secondary">{id === "free" ? "forever" : "per month"}</span>
                  <span className="mt-2 text-callout text-fg-secondary">{id === "free" ? "The full editor, watermarked export" : plan.features[0]}</span>
                </div>
              );
            })}
          </div>
          <TextLink href="/pricing">Compare plans</TextLink>
        </Reveal>
      </section>

      {/* ── Questions ───────────────────────────────────────────────────── */}
      <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-(--bar-height) bg-surface px-6 py-24">
        <div className="mx-auto grid max-w-(--content-max) gap-10 lg:grid-cols-[1fr_2fr]">
          <Reveal>
            <h2 id="faq-heading" className="text-section text-fg">
              Questions?
              <br />
              Answers.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <Faq items={faq} />
          </Reveal>
        </div>
      </section>

      {/* ── Closing call to action ──────────────────────────────────────── */}
      <section className="px-6 py-24">
        <Reveal className="mx-auto flex max-w-(--content-max) flex-col items-center gap-8 rounded-tile bg-tile-dark px-6 py-20 text-center">
          <h2 className="text-section text-balance text-tile-dark-fg">Your next flyer is one sentence away.</h2>
          <ButtonLink href="/dashboard" size="lg" shape="capsule">
            Start creating
          </ButtonLink>
        </Reveal>
      </section>
    </>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="focus-ring group inline-flex items-center gap-0.5 rounded-button text-headline font-normal text-accent-text">
      <span className="group-hover:underline underline-offset-4">{children}</span>
      <ChevronRight aria-hidden className="size-4 translate-y-px" />
    </Link>
  );
}

function Tile({ eyebrow, title, children, dark, className }: { eyebrow: string; title: string; children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <Reveal className={cn("flex min-h-80 flex-col gap-3 rounded-tile p-8 sm:p-10", dark ? "bg-tile-dark" : "bg-surface shadow-card", className)}>
      <span className="text-eyebrow text-accent-warm">{eyebrow}</span>
      <h3 className={cn("text-title text-balance", dark ? "text-tile-dark-fg" : "text-fg")}>{title}</h3>
      {children}
    </Reveal>
  );
}
