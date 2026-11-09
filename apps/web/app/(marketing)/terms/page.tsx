import type { Metadata } from "next";

import { Contact, LegalPage } from "@/components/marketing/legal-page";
import { PRODUCT_NAME } from "@/components/shell/wordmark";
import { CREDIT_COSTS, PLANS } from "@flyer/billing/plans";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="November 7, 2026">
      <section>
        <p>
          These terms cover your use of {PRODUCT_NAME}. By creating an account or using the service, you agree to them.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          You’re responsible for activity on your account and for keeping access to your email or Google account secure. You
          must be old enough to form a binding agreement where you live.
        </p>
      </section>

      <section>
        <h2>Plans, credits and billing</h2>
        <ul>
          <li>
            Generating a set of three designs uses {CREDIT_COSTS.generate} credits; exports use{" "}
            {Math.min(...Object.values(CREDIT_COSTS.export))}–{Math.max(...Object.values(CREDIT_COSTS.export))} credits depending
            on format. If a generation fails, its credits are returned automatically.
          </li>
          <li>
            Paid plans ({PLANS.pro.name} and {PLANS.max.name}) are prepaid passes for one month or twelve months, paid once through
            Paynow. A pass adds its credits when the payment is confirmed and lasts until the date shown in Billing.
          </li>
          <li>Passes never renew or charge you automatically. When a pass ends your account returns to Free; credits you hold stay on your account.</li>
          <li>Free-plan exports carry a watermark, and Free-plan projects are deleted 30 days after their last edit.</li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          Your prompts, uploads and designs are yours. You give us permission to store and process them only to provide the
          service. Make sure you have the rights to anything you upload, and check every flyer — names, dates, prices and
          contact details — before you print or publish it.
        </p>
        <p>
          Paid plans include commercial use of the flyers you create. Stock photos come from Unsplash under the Unsplash
          License, and photographer credits are shown in the editor.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Don’t use {PRODUCT_NAME} to create unlawful, deceptive, hateful or infringing material, or to impersonate others. We
          may decline prompts, and suspend accounts that break these rules.
        </p>
      </section>

      <section>
        <h2>AI-assisted design</h2>
        <p>
          Designs are created with the help of AI models and an automated layout engine. We work to keep them accurate — for
          example, details you didn’t provide are removed — but results can still contain mistakes, so review them before use.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          We provide {PRODUCT_NAME} as it is and may change or improve it over time. To the extent the law allows, we aren’t
          liable for indirect or consequential losses arising from its use. If we change these terms in a meaningful way, we’ll
          update the date above.
        </p>
        <Contact>
          {(email) => (
            <p>
              Questions? Contact us at{" "}
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
