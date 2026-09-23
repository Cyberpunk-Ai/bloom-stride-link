import { createHash, createHmac } from "node:crypto";

import type {
  StorageDownloadResult,
  StorageProvider,
  StorageUploadInput,
  StorageUploadResult,
} from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

/**
 * S3 / Cloudflare R2 compatible adapter using hand-rolled SigV4 presigning
 * (no `@aws-sdk/*` dependency). Works against any S3-compatible endpoint set
 * via `S3_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`).
 */

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

function requireConfig(): S3Config {
  const cfg = getProviderConfig();
  const { endpoint, region, accessKeyId, secretAccessKey, publicBaseUrl } = cfg.storage.s3;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 storage isn't configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
    );
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    region: region || "auto",
    accessKeyId,
    secretAccessKey,
    bucket: cfg.storage.bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
  };
}

/** Presigns a request for `method` against `path`, valid for `expiresInSeconds`. */
function presign(
  cfg: S3Config,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  expiresInSeconds: number,
  extraHeaders: Record<string, string> = {},
): string {
  const host = new URL(cfg.endpoint).host;
  const { amzDate: date, dateStamp } = amzDate();
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const canonicalUri = `/${cfg.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const signedHeaderNames = ["host", ...Object.keys(extraHeaders).map((h) => h.toLowerCase())].sort();
  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaderNames.join(";"),
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
    .join("&");

  const canonicalHeaders =
    signedHeaderNames.map((h) => `${h}:${h === "host" ? host : extraHeaders[h]}\n`).join("") ;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createS3Storage(): StorageProvider {
  return {
    async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
      const cfg = requireConfig();
      const url = presign(cfg, "PUT", input.path, 300, {
        "content-type": input.contentType || "application/octet-stream",
      });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": input.contentType || "application/octet-stream" },
        body: input.data as any,
      });
      if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
      const publicUrl = cfg.publicBaseUrl
        ? `${cfg.publicBaseUrl}/${input.path}`
        : `${cfg.endpoint}/${cfg.bucket}/${input.path}`;
      return { path: input.path, url: publicUrl };
    },

    async signedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
      const cfg = requireConfig();
      return presign(cfg, "GET", path, expiresInSeconds);
    },

    async delete(path: string): Promise<void> {
      const cfg = requireConfig();
      const url = presign(cfg, "DELETE", path, 60);
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status})`);
    },

    async download(path: string): Promise<StorageDownloadResult | null> {
      const cfg = requireConfig();
      const url = presign(cfg, "GET", path, 60);
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      return { data, contentType: res.headers.get("content-type") ?? undefined };
    },
  };
}
