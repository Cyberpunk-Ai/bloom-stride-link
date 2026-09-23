/**
 * Posts can carry several attachments in one `media_url` field, stored as a
 * comma-separated list. Anything that renders a single image must take the
 * first entry, never the raw string (a joined string 404s).
 */
export function mediaUrlList(value?: string | null | string[]): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : value.split(",");
  return parts.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
}

export function firstMediaUrl(value?: string | null | string[]): string | undefined {
  return mediaUrlList(value)[0];
}
