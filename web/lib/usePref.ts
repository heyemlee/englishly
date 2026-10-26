"use client";

import { useCallback, useSyncExternalStore } from "react";

import { loadPref, savePref } from "@/lib/api";

const listeners = new Set<() => void>();

/**
 * A small per-browser preference (localStorage) that is safe in server-rendered pages:
 * the server and the first client render use `fallback`, then the stored value takes over.
 */
export function usePref<T extends string | number | boolean>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => loadPref(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T) => {
      savePref(key, next);
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
