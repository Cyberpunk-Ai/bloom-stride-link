import { createFileRoute, Link } from "@tanstack/react-router";

import { appConfig } from "@/lib/config";

import { LegalShell } from "./about";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Spaces1 — support and press" },
      {
        name: "description",
        content:
          "How to reach the Spaces1 team for support, safety reports, billing questions, press and partnerships.",
      },
      { property: "og:title", content: "Contact Spaces1 — support and press" },
      {
        property: "og:description",
        content: "Support, safety, billing and press contacts for Spaces1.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const email = appConfig.brand.supportEmail;
  return (
    <LegalShell title="Contact us" intro="We read everything and reply as quickly as we can.">
      <h2>Support</h2>
      <p>
        Email <a href={`mailto:${email}`}>{email}</a>, or open a ticket from{" "}
        <Link to="/settings">Settings</Link> if you're signed in — tickets keep your history in one
        thread.
      </p>
      <h2>Safety reports</h2>
      <p>
        Use the report option on any post, story or account. Urgent safety issues: email{" "}
        <a href={`mailto:${email}`}>{email}</a> with "Safety" in the subject.
      </p>
      <h2>Billing and withdrawals</h2>
      <p>
        Plan changes, receipts and withdrawal questions are handled from{" "}
        <Link to="/settings">Settings</Link>. We never ask for card or bank details by email.
      </p>
      <h2>Press and partnerships</h2>
      <p>
        Email <a href={`mailto:${email}`}>{email}</a> and tell us a little about what you have in
        mind.
      </p>
    </LegalShell>
  );
}
