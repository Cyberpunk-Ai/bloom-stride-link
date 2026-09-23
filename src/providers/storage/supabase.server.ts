import type {
  StorageDownloadResult,
  StorageProvider,
  StorageUploadInput,
  StorageUploadResult,
} from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

/**
 * Wraps the private Supabase Storage bucket. Reads go through the app's own
 * `/api/public/media/*` proxy so links never expire, matching the existing
 * behaviour of `uploadMedia` in `src/lib/api-client.ts`.
 */
export function createSupabaseStorage(): StorageProvider {
  const bucket = getProviderConfig().storage.bucket;

  async function admin() {
    const mod = await import("@/integrations/supabase/client.server");
    return mod.supabaseAdmin;
  }

  return {
    async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
      const client = await admin();
      const { error } = await client.storage
        .from(bucket)
        .upload(input.path, input.data as any, {
          upsert: input.upsert ?? true,
          contentType: input.contentType,
        });
      if (error) throw new Error(error.message);
      return { path: input.path, url: `/api/public/media/${input.path}` };
    },

    async signedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
      const client = await admin();
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data) throw new Error(error?.message ?? "Could not sign URL");
      return data.signedUrl;
    },

    async delete(path: string): Promise<void> {
      const client = await admin();
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error(error.message);
    },

    async download(path: string): Promise<StorageDownloadResult | null> {
      const client = await admin();
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) return null;
      return { data, contentType: data.type || undefined };
    },
  };
}
