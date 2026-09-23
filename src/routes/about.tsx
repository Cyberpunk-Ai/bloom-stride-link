import { createFileRoute, Link } from "@tanstack/react-router";

import { appConfig } from "@/lib/config";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Spaces1 — our story" },
      {
        name: "description",
        content:
          "Spaces1 is a creator social network built around live audio rooms, stories and fair creator earnings. Learn who we build for and how we make money.",
      },
      { property: "og:title", content: "About Spaces1 — our story" },
      {
        property: "og:description",
        content: "Why we built Spaces1 and how creators keep most of what they earn.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <LegalShell title="About Spaces1" intro={appConfig.brand.tagline}>
      <p>
        Spaces1 is a social home for creators and the communities around them. Posts, stories,
        live audio rooms, direct messages and calls live in one place, so a conversation can move
        from a comment to a room without anyone leaving the app.
      </p>
      <h2>How we make money</h2>
      <p>
        Creators earn tips directly from their audience. We keep a small percentage of creator
        earnings at withdrawal — 5% on Free, 3% on Creator and 1% on Studio — and memberships
        cover the rest. There are no ads in the feed.
      </p>
      <h2>Payments and your details</h2>
      <p>
        Card, bank and wallet details are never stored by Spaces1. Everything to do with taking a
        payment or sending a withdrawal is handled by our payment provider.
      </p>
      <h2>Talk to us</h2>
      <p>
        Questions, press or partnerships: <Link to="/contact">get in touch</Link>.
      </p>
    </LegalShell>
  );
}

/** Shared reading layout for the simple content pages. */
export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand hover:underline"
        >
          ← Back to Spaces1
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {intro ? <p className="mt-3 text-base text-muted-foreground">{intro}</p> : null}
        <div className="prose-spaces mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-brand [&_a:hover]:underline [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
      </div>
    </main>
  );
}
