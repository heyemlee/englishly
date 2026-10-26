import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import LogoutLink from "@/components/LogoutLink";
import { CurrentNavLinks, NavLinks, TabBar } from "@/components/Nav";
import { LogoMark } from "@/components/icons";

export const metadata: Metadata = {
  title: "PodEcho 播客精听",
  description: "用 YouTube 和播客逐句练英语听力和口语。",
  appleWebApp: { capable: true, title: "PodEcho", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest", // lets phones "Add to Home Screen" and open the app full screen
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="z-40 px-[max(1rem,env(safe-area-inset-left))] pt-3 md:sticky md:top-0 md:pt-4">
          <div className="md:glass-strong mx-auto flex h-11 max-w-6xl items-center gap-3 md:grid md:h-14 md:grid-cols-[1fr_auto_1fr] md:rounded-full md:pl-5 md:pr-2">
            <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
              <LogoMark />
              PodEcho
            </Link>
            {/* The URL of a not-yet-known episode page isn't available while prerendering. */}
            <Suspense fallback={<NavLinks pathname={null} />}>
              <CurrentNavLinks />
            </Suspense>
            <div className="ml-auto flex justify-end">
              <LogoutLink />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-[max(1rem,env(safe-area-inset-left))] pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-5 md:pb-20 md:pt-10">
          {children}
        </main>
        <Suspense fallback={null}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
