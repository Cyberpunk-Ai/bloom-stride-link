import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalShell } from "./about";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Notice — Spaces1" },
      {
        name: "description",
        content:
          "What Spaces1 collects, how your feed is personalised, who can see your stories, and why we never store card or bank details.",
      },
      { property: "og:title", content: "Privacy Notice — Spaces1" },
      {
        property: "og:description",
        content: "What we collect, what we never store, and how to get your data removed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalShell title="Privacy Notice" intro="Last updated: September 2026.">
      <h2>What we collect</h2>
      <p>
        Your account details (email, name, photo), the things you post, who you follow, and the
        posts you view, like, repost, bookmark or reply to.
      </p>
      <h2>How your feed is personalised</h2>
      <p>
        "For you" is ranked from your own activity — the topics and accounts you engage with, who
        you follow, and how recent and well-received a post is. You can switch to "Following" at
        any time to see only the accounts you follow.
      </p>
      <h2>Who can see your stories</h2>
      <p>
        Stories are visible to you, to people you follow and to people who follow you, and only
        for 24 hours. After that they stop being readable.
      </p>
      <h2>What we never store</h2>
      <p>
        Card numbers, bank accounts and wallet details. Payments and withdrawals are handled
        entirely by our payment provider.
      </p>
      <h2>Your choices</h2>
      <p>
        You can edit or delete your posts and stories, and ask us to remove your account and its
        data — <Link to="/contact">contact us</Link> and we'll take care of it.
      </p>
    </LegalShell>
  );
}
