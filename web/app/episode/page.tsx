import { Suspense } from "react";

import Practice from "@/components/Practice";

// /episode?id=…&s=… rather than /episodes/[id]: one page for every episode, so it also works as a static site.
export default function EpisodePage() {
  // Practice reads the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="text-sm text-muted">加载中…</p>}>
      <Practice />
    </Suspense>
  );
}
