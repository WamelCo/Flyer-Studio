import type { Metadata } from "next";

import { Contact, LegalPage } from "@/components/marketing/legal-page";
import { PRODUCT_NAME } from "@/components/shell/wordmark";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="November 7, 2026">
      <section>
        <p>
          This policy explains what {PRODUCT_NAME} collects when you use it, why, and who helps us provide the service. We
          collect only what we need to design, store and export your flyers and to run your account.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Your account: your email address, or your Google profile’s email and name if you sign in with Google.</li>
          <li>Your work: the prompts you write, the designs and projects you create, and images you upload.</li>
          <li>
            Billing: your plan, credit balance and subscription status. Payments are processed by Stripe; we never see or store
            your card number.
          </li>
          <li>Service records: a log of credit changes, and error reports when a generation fails, so we can fix problems.</li>
        </ul>
      </section>

      <section>
        <h2>Who helps us provide the service</h2>
        <ul>
          <li>Supabase hosts our database, sign-in and file storage.</li>
          <li>Stripe processes subscriptions and payments.</li>
          <li>
            AI providers receive the text of your prompt to write the design brief, and, for the lead design, the brief and copy
            to illustrate it. Depending on configuration this may be Groq, Anthropic, Z.AI, DeepSeek or Ideogram.
          </li>
          <li>Unsplash receives short search terms derived from your prompt to find stock photos, and is told when a photo is used.</li>
          {process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN ? <li>Sentry receives error reports (what failed and where) so we can fix problems; they exclude your prompts and designs.</li> : null}
          {process.env.NEXT_PUBLIC_POSTHOG_KEY ? <li>PostHog receives product usage events (for example, that a design was generated), tied to an anonymous account ID and set without cookies.</li> : null}
        </ul>
        <p>We don’t sell your information and we don’t use advertising trackers.</p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          We use cookies only to keep you signed in and to remember whether you collapsed the sidebar. There are no analytics or
          advertising cookies.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          Projects on the Free plan are deleted 30 days after you last edit them. On paid plans, projects are kept while your
          account is active. You can delete a project at any time from Projects.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can access, correct or delete your work from inside the app, and manage or cancel your subscription from Billing.
          You can ask us for a copy of your data or to delete your account.
        </p>
        <Contact>
          {(email) => (
            <p>
              Contact us at{" "}
              <a href={`mailto:${email}`} className="text-accent-text underline underline-offset-2">
                {email}
              </a>
              .
            </p>
          )}
        </Contact>
      </section>
    </LegalPage>
  );
}
