import { useEffect, useState } from "react";

const STORAGE_PREFIX = "spaces:stories-visible:";

function readStored(userId: string): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + userId);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

function defaultVisible(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= 768;
}

/**
 * Per-user, localStorage-persisted show/hide state for the stories rail.
 * Collapsed by default on small screens (<768px), expanded by default on larger ones,
 * unless the user has explicitly toggled it before.
 */
export function useStoriesVisibility(userId: string) {
  const [visible, setVisibleState] = useState<boolean>(() => {
    const stored = readStored(userId);
    return stored ?? defaultVisible();
  });

  useEffect(() => {
    const stored = readStored(userId);
    setVisibleState(stored ?? defaultVisible());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function setVisible(next: boolean) {
    setVisibleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PREFIX + userId, next ? "1" : "0");
    }
  }

  return { visible, setVisible, toggle: () => setVisible(!visible) };
}
