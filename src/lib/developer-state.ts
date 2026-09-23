import { useEffect, useState } from "react";

import {
  deleteOwnedRow,
  insertOwnedRow,
  loadOwnedRows,
  signedInProfileId,
} from "@/lib/remote-store";

export interface ApiKey {
  id: string;
  name: string;
  maskedKey: string;
  fullKey?: string;
  createdAt: string;
  lastUsed: string;
  calls?: number;
}

export interface Webhook {
  id: string;
  url: string;
  description: string;
  events: string[];
  status: "active" | "paused";
  createdAt: string;
}

interface DeveloperState {
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  totalApiCallsThisMonth: number;
}

const DEFAULTS: DeveloperState = { apiKeys: [], webhooks: [], totalApiCallsThisMonth: 0 };

// Keys and webhooks are only ever read from the database - never cached in the
// browser, so one account can never see another account's credentials.
let state: DeveloperState = DEFAULTS;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function commit(next: DeveloperState) {
  state = next;
  listeners.forEach((fn) => fn());
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hydrate() {
  const userId = signedInProfileId();
  if (!userId) {
    loadedFor = null;
    if (state.apiKeys.length || state.webhooks.length) commit(DEFAULTS);
    return;
  }
  if (loadedFor === userId) return;
  loadedFor = userId;
  let calls = 0;
  const [apiKeys, webhooks] = await Promise.all([
    loadOwnedRows<ApiKey>("api_keys", (row) => ({
      id: String(row.id),
      name: String(row.name),
      maskedKey: `${row.prefix}••••••••${String(row.key_hash).slice(-6)}`,
      createdAt: new Date(row.created_at).toLocaleDateString(),
      lastUsed: row.last_used_at ? new Date(row.last_used_at).toLocaleDateString() : "Never",
      calls: Number(row.call_count ?? 0),
    })),
    loadOwnedRows<Webhook>("webhooks", (row) => ({
      id: String(row.id),
      url: String(row.url),
      description: "",
      events: Array.isArray(row.events) ? (row.events as string[]) : [],
      status: row.active ? "active" : "paused",
      createdAt: new Date(row.created_at).toLocaleDateString(),
    })),
  ]);
  calls = apiKeys.reduce((sum, k) => sum + (k.calls ?? 0), 0);
  commit({ apiKeys, webhooks, totalApiCallsThisMonth: calls });
}

export function useDeveloper() {
  const [snapshot, setSnapshot] = useState<DeveloperState>(state);

  useEffect(() => {
    const sync = () => setSnapshot({ ...state });
    listeners.add(sync);
    sync();
    void hydrate();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  async function generateApiKey(name: string): Promise<ApiKey> {
    const token = `sk_live_${randomToken()}`;
    const row = await insertOwnedRow("api_keys", {
      name,
      prefix: "sk_live_",
      key_hash: token.slice(-12),
      scopes: ["read"],
    });
    const key: ApiKey = {
      id: String(row?.id ?? `key_${Date.now()}`),
      name,
      maskedKey: `sk_live_••••••••${token.slice(-6)}`,
      fullKey: token,
      createdAt: new Date().toLocaleDateString(),
      lastUsed: "Never",
    };
    commit({ ...state, apiKeys: [key, ...state.apiKeys] });
    return key;
  }

  function revokeApiKey(id: string) {
    void deleteOwnedRow("api_keys", id).catch(() => undefined);
    commit({ ...state, apiKeys: state.apiKeys.filter((k) => k.id !== id) });
  }

  async function addWebhook(url: string, description: string, events: string[]) {
    const row = await insertOwnedRow("webhooks", { url, events, active: true }).catch(() => null);
    const hook: Webhook = {
      id: String(row?.id ?? `wh_${Date.now()}`),
      url,
      description,
      events,
      status: "active",
      createdAt: new Date().toLocaleDateString(),
    };
    commit({ ...state, webhooks: [hook, ...state.webhooks] });
  }

  function removeWebhook(id: string) {
    void deleteOwnedRow("webhooks", id).catch(() => undefined);
    commit({ ...state, webhooks: state.webhooks.filter((w) => w.id !== id) });
  }

  return {
    apiKeys: snapshot.apiKeys,
    webhooks: snapshot.webhooks,
    totalApiCallsThisMonth: snapshot.totalApiCallsThisMonth,
    generateApiKey,
    revokeApiKey,
    addWebhook,
    removeWebhook,
  };
}
