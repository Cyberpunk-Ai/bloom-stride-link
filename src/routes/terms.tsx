import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalShell } from "./about";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Spaces1" },
      {
        name: "description",
        content:
          "The rules for using Spaces1: your account, your content, creator earnings and withdrawals, and when we may suspend an account.",
      },
      { property: "og:title", content: "Terms of Service — Spaces1" },
      {
        property: "og:description",
        content: "The rules for using Spaces1, in plain language.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalShell title="Terms of Service" intro="Last updated: September 2026.">
      <h2>Your account</h2>
      <p>
        You need an account to post, message, host rooms or send tips. Keep your sign-in details
        to yourself, and tell us if you think someone else has used your account.
      </p>
      <h2>Your content</h2>
      <p>
        What you post stays yours. By posting you allow us to show it to the people you have
        shared it with inside Spaces1. Don't post anything illegal, hateful, or that you don't
        have the right to share.
      </p>
      <h2>Creator earnings</h2>
      <p>
        Tips you receive appear in your earnings. A platform fee is taken from creator earnings at
        withdrawal — 5% on Free, 3% on Creator and 1% on Studio — and it is always shown before
        you confirm. Withdrawals are reviewed and paid through our payment provider.
      </p>
      <h2>Ending an account</h2>
      <p>
        You can stop using Spaces1 at any time. We may suspend an account that breaks these terms
        or puts other people at risk.
      </p>
      <h2>Questions</h2>
      <p>
        See our <Link to="/privacy">privacy notice</Link> or{" "}
        <Link to="/contact">contact us</Link>.
      </p>
    </LegalShell>
  );
}
