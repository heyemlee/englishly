"use client";

import { useEffect, useState } from "react";

import { api, type Health } from "@/lib/api";

let cached: Promise<Health> | null = null;

/** /api/health, fetched once per page load and shared (null until it arrives or if it fails). */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    cached ??= api.health();
    cached.then(setHealth).catch(() => {
      cached = null;
    });
  }, []);
  return health;
}
