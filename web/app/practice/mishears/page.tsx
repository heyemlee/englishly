import { Suspense } from "react";
import MishearDrill from "@/components/MishearDrill";

export default function Page() {
  return <Suspense fallback={<p className="text-sm text-muted">正在准备错题…</p>}><MishearDrill /></Suspense>;
}
