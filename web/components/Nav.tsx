"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconBook, IconCards, IconChart, IconMic, IconShows } from "@/components/icons";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/", label: "节目", Icon: IconShows },
  { href: "/review", label: "复习", Icon: IconCards },
  { href: "/retell", label: "复述", Icon: IconMic },
  { href: "/chunks", label: "单词本", Icon: IconBook },
  { href: "/stats", label: "数据", Icon: IconChart },
] as const;

function section(pathname: string | null) {
  if (!pathname) return null;
  if (pathname === "/" || pathname.startsWith("/episode")) return "/";
  if (pathname.startsWith("/practice")) return "/stats"; // the mishear drill belongs to the mishear book
  return NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href))?.href ?? null;
}

/** Wide screens: the links in the floating top bar. `pathname` is null while the URL isn't known yet. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  const active = section(pathname);
  return (
    <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={active === href ? "page" : undefined}
          className={cx(
            "rounded-full px-4 py-1.5 text-sm transition-colors",
            active === href ? "bg-fill-strong font-medium text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function CurrentNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

/** Phones: a floating tab bar. The practice page puts its own playback controls there instead. */
export function TabBar() {
  const pathname = usePathname();
  if (pathname.startsWith("/episode") || pathname.startsWith("/login")) return null;
  const active = section(pathname);
  return (
    <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
      <div className="glass-strong mx-auto flex max-w-md rounded-full p-1">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={cx(
              "flex flex-1 flex-col items-center gap-0.5 rounded-full pb-1.5 pt-2 text-[10.5px] font-medium transition-colors",
              active === href ? "bg-fill-strong text-foreground" : "text-muted active:text-foreground",
            )}
          >
            <Icon className="size-[22px]" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
