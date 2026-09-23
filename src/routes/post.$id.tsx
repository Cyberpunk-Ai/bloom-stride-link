import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { AppShell, PageHeader, Panel } from "@/components/social/AppShell";
import { PostCard } from "@/components/social/PostCard";
import { DefaultRail } from "@/components/social/RightRail";
import { getPostById } from "@/lib/api-client";
import { useRealtime } from "@/lib/realtime";
import type { Post } from "@/lib/types";

export const Route = createFileRoute("/post/$id")({
  head: () => ({
    meta: [
      { title: "Post — Spaces1" },
      {
        name: "description",
        content:
          "Read this post on Spaces1, join the replies and follow the creator behind it.",
      },
      { property: "og:title", content: "Post — Spaces1" },
      {
        property: "og:description",
        content: "Read this post on Spaces1 and join the conversation.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    getPostById(id)
      .then(setPost)
      .catch(() => setPost(null))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  useRealtime(
    {
      "post:deleted": (payload: any) => {
        if (payload?.id === id) setPost(null);
      },
      new_comment: (payload: any) => {
        if (payload?.postId === id) load();
      },
    },
    [id],
  );

  return (
    <AppShell title="Post" right={<DefaultRail />}>
      <PageHeader
        title="Post"
        subtitle="Shared conversation"
        action={
          <Link
            to="/feed"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
          </Link>
        }
      />

      {loading ? (
        <Panel className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading post…
        </Panel>
      ) : post ? (
        <PostCard post={post} />
      ) : (
        <Panel className="p-10 text-center">
          <h2 className="text-base font-semibold text-foreground">This post isn’t available</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have been deleted, or the link is incorrect.
          </p>
          <Link
            to="/feed"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back to the feed
          </Link>
        </Panel>
      )}
    </AppShell>
  );
}
