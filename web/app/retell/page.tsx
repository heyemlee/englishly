import { Suspense } from "react";

import Retell from "@/components/Retell";

export default function RetellPage() {
  // Retell reads ?episode=&clip= (useSearchParams), which needs a Suspense boundary with Cache Components.
  return (
    <Suspense fallback={<p className="text-sm text-muted">加载中…</p>}>
      <Retell />
    </Suspense>
  );
}
