/**
 * Developer API: server-generated keys (only a sha256 hash is ever stored),
 * a verifier for public API routes, and signed outgoing webhooks.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getAdmin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin as any;
}

async function getActor(context: any) {
  const admin = await getAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name, username")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (!profile) throw new Error("We couldn't find your profile.");
  return { admin, profile };
}

async function sha256Hex(input: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input).digest("hex");
}

/** Generates a new API key. The full token is returned exactly once. */
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(80),
        scopes: z.array(z.string()).default(["read"]),
        expiresAt: z.string().datetime().nullable().optional(),
        rateLimitPerMin: z.number().int().min(1).max(6000).default(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { randomBytes } = await import("node:crypto");
    const token = `sk_live_${randomBytes(24).toString("hex")}`;
    const keyHash = await sha256Hex(token);
    const prefix = token.slice(0, 12);

    const { data: created, error } = await admin
      .from("api_keys")
      .insert({
        user_id: profile.id,
        name: data.name,
        prefix,
        key_hash: keyHash,
        scopes: data.scopes,
        expires_at: data.expiresAt ?? null,
        rate_limit_per_min: data.rateLimitPerMin,
      })
      .select("id, name, prefix, created_at, scopes, expires_at, rate_limit_per_min")
      .maybeSingle();
    if (error || !created) throw new Error(error?.message ?? "Couldn't create that key.");

    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      actor_name: profile.display_name || profile.username,
      actor_role: "developer",
      action: "api_key.create",
      target_type: "api_key",
      target_id: created.id,
      details: `Created API key "${data.name}"`,
    });

    return { ...created, token };
  });

/** Lists the caller's own keys. The hash is never returned. */
export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, profile } = await getActor(context);
    const { data } = await admin
      .from("api_keys")
      .select("id, name, prefix, created_at, last_used_at, call_count, revoked, expires_at, scopes, rate_limit_per_min")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { data: row } = await admin.from("api_keys").select("id, user_id, name").eq("id", data.id).maybeSingle();
    if (!row || row.user_id !== profile.id) throw new Error("That key doesn't belong to you.");
    const { error } = await admin.from("api_keys").update({ revoked: true }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      actor_name: profile.display_name || profile.username,
      actor_role: "developer",
      action: "api_key.revoke",
      target_type: "api_key",
      target_id: data.id,
      details: `Revoked API key "${row.name}"`,
      severity: "warning",
    });
    return { ok: true };
  });

/** Rotates a key: issues a new token/hash for the same row, un-revokes it. */
export const rotateApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { data: row } = await admin.from("api_keys").select("id, user_id, name").eq("id", data.id).maybeSingle();
    if (!row || row.user_id !== profile.id) throw new Error("That key doesn't belong to you.");

    const { randomBytes } = await import("node:crypto");
    const token = `sk_live_${randomBytes(24).toString("hex")}`;
    const keyHash = await sha256Hex(token);
    const prefix = token.slice(0, 12);

    const { error } = await admin
      .from("api_keys")
      .update({ key_hash: keyHash, prefix, revoked: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      actor_name: profile.display_name || profile.username,
      actor_role: "developer",
      action: "api_key.rotate",
      target_type: "api_key",
      target_id: data.id,
      details: `Rotated API key "${row.name}"`,
      severity: "warning",
    });

    return { id: row.id, prefix, token };
  });

export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, profile } = await getActor(context);
    const { data } = await admin
      .from("webhooks")
      .select("id, url, events, active, failure_count, last_delivery_at, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });
    return data ?? [];
  });

/** Creates a webhook and returns its signing secret exactly once. */
export const createWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ url: z.string().url(), events: z.array(z.string()).min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { randomBytes } = await import("node:crypto");
    const secret = randomBytes(32).toString("hex");

    const { data: created, error } = await admin
      .from("webhooks")
      .insert({ user_id: profile.id, url: data.url, events: data.events, secret, active: true })
      .select("id, url, events, active, created_at")
      .maybeSingle();
    if (error || !created) throw new Error(error?.message ?? "Couldn't create that webhook.");

    await admin.from("audit_logs").insert({
      actor_id: profile.id,
      actor_name: profile.display_name || profile.username,
      actor_role: "developer",
      action: "webhook.create",
      target_type: "webhook",
      target_id: created.id,
      details: `Registered webhook for ${data.url}`,
    });

    return { ...created, secret };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { data: row } = await admin.from("webhooks").select("id, user_id").eq("id", data.id).maybeSingle();
    if (!row || row.user_id !== profile.id) throw new Error("That webhook doesn't belong to you.");
    const { error } = await admin.from("webhooks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWebhookDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ webhookId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { data: hook } = await admin.from("webhooks").select("id, user_id").eq("id", data.webhookId).maybeSingle();
    if (!hook || hook.user_id !== profile.id) throw new Error("That webhook doesn't belong to you.");
    const { data: rows } = await admin
      .from("webhook_deliveries")
      .select("*")
      .eq("webhook_id", data.webhookId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

/** Sends a real signed test delivery and records the attempt/outcome. */
export const sendTestWebhookDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ webhookId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin, profile } = await getActor(context);
    const { data: hook } = await admin.from("webhooks").select("*").eq("id", data.webhookId).maybeSingle();
    if (!hook || hook.user_id !== profile.id) throw new Error("That webhook doesn't belong to you.");

    const { deliverWebhook } = await import("@/lib/webhook-delivery.server");
    const result = await deliverWebhook(admin, hook, "test.ping", { message: "Hello from Spaces1" });
    return result;
  });
