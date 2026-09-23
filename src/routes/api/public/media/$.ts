import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_FOLDERS = ["avatars", "posts", "stories", "media", "messages"];

/**
 * Public read proxy for the private `media` bucket. Uploaded files are stored
 * privately; this route streams them back so links never expire and no signed
 * URL has to be refreshed client-side. Read-only: no writes, no PII.
 */
export const Route = createFileRoute("/api/public/media/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const raw = String((params as { _splat?: string })._splat ?? "");
        const path = raw.replace(/^\/+/, "");

        if (!path || path.includes("..") || !ALLOWED_FOLDERS.includes(path.split("/")[0] ?? "")) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from("media").download(path);

        if (error || !data) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(data, {
          headers: {
            "Content-Type": data.type || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
