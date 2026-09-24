import { createHmac } from "node:crypto";

type Hook = { id: string; url: string; secret?: string | null; failure_count?: number | null };

/** Sends a signed webhook (HMAC-SHA256 over `${timestamp}.${body}`) and records the delivery. */
export async function deliverWebhook(admin: any, hook: Hook, event: string, payload: unknown) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload });
  const signature = createHmac("sha256", hook.secret ?? "").update(`${timestamp}.${body}`).digest("hex");

  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const url = new URL(hook.url);
    if (url.protocol !== "https:") throw new Error("Webhook URLs must use https.");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": `sha256=${signature}`,
      },
      body,
    });
    statusCode = res.status;
    ok = res.ok;
    if (!ok) error = `Endpoint responded with ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : "Delivery failed";
  }

  await admin.from("webhook_deliveries").insert({ webhook_id: hook.id, event, ok, status_code: statusCode, error });
  await admin
    .from("webhooks")
    .update({
      last_delivery_at: new Date().toISOString(),
      failure_count: ok ? 0 : (hook.failure_count ?? 0) + 1,
    })
    .eq("id", hook.id);

  return { ok, statusCode, error };
}
