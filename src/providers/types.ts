/**
 * Provider interfaces. Every backend concern (storage, AI, payments, email,
 * realtime) is defined here as a small contract so any vendor can be swapped
 * behind `src/providers/index.server.ts` factories purely via env vars.
 *
 * Server-only. Do not import this from client bundles for the concrete
 * adapters — the interfaces themselves have no side effects and are safe to
 * share, but the `*.server.ts` adapter modules read secrets and must only be
 * imported from server code (server functions / API routes).
 */

/** Amounts are always expressed in minor units (e.g. cents) to avoid float bugs. */
export type MoneyAmount = number;

export interface StorageUploadInput {
  /** Path within the bucket, e.g. "avatars/<userId>/<file>.jpg". */
  path: string;
  data: Blob | ArrayBuffer | Uint8Array | Buffer;
  contentType?: string;
  upsert?: boolean;
}

export interface StorageUploadResult {
  path: string;
  /** Publicly reachable (or proxy) URL clients can use to render the file. */
  url: string;
}

export interface StorageDownloadResult {
  data: Blob | ArrayBuffer;
  contentType?: string;
}

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  /** Signed, time-limited URL for reading a private object. */
  signedUrl(path: string, expiresInSeconds?: number): Promise<string>;
  delete(path: string): Promise<void>;
  /** Optional: fetch bytes directly, used by same-origin proxy routes. */
  download?(path: string): Promise<StorageDownloadResult | null>;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProvider {
  chat(messages: AiChatMessage[]): Promise<string>;
  /** Optional: only implemented by providers that support image generation. */
  image?(prompt: string): Promise<{ url: string } | { base64: string }>;
}

export interface PaymentsInitCheckoutInput {
  email: string;
  amount: MoneyAmount;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentsInitCheckoutResult {
  authorizationUrl: string;
  reference: string;
}

export interface PaymentsVerifyResult {
  reference: string;
  status: "success" | "failed" | "pending";
  amount: MoneyAmount;
  currency: string;
  customerCode?: string | null;
  metadata?: Record<string, unknown>;
  raw?: unknown;
}

export interface PaymentsRefundInput {
  reference: string;
  amount?: MoneyAmount;
}

export interface PaymentsCreateRecipientInput {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: string;
}

export interface PaymentsCreateRecipientResult {
  recipientCode: string;
  raw?: unknown;
}

export interface PaymentsTransferInput {
  recipientCode: string;
  amount: MoneyAmount;
  reason?: string;
  reference?: string;
}

export interface PaymentsTransferResult {
  transferCode: string;
  status: string;
  raw?: unknown;
}

export interface PaymentsWebhookEvent {
  type: string;
  reference?: string;
  raw: unknown;
}

export interface PaymentsProvider {
  initCheckout(input: PaymentsInitCheckoutInput): Promise<PaymentsInitCheckoutResult>;
  verify(reference: string): Promise<PaymentsVerifyResult>;
  refund(input: PaymentsRefundInput): Promise<void>;
  createRecipient(input: PaymentsCreateRecipientInput): Promise<PaymentsCreateRecipientResult>;
  transfer(input: PaymentsTransferInput): Promise<PaymentsTransferResult>;
  /** Verifies a raw webhook body/signature pair belongs to this provider. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
  parseEvent(rawBody: string): PaymentsWebhookEvent;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface EmailProvider {
  send(input: EmailSendInput): Promise<void>;
}

export interface RealtimeChangeHandler {
  (payload: unknown): void;
}

export interface RealtimeProvider {
  /** Subscribe to database change events on a table (server or client). */
  subscribeChanges(table: string, handler: RealtimeChangeHandler): () => void;
  /** Broadcast an app-level event to all connected clients. */
  broadcast(event: string, payload: unknown): void;
}
