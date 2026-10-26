"use client";

import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { useHealth } from "@/lib/useHealth";
import { IconLogout } from "@/components/icons";

/** In the nav when a password protects the server. */
export default function LogoutLink() {
  const router = useRouter();
  const health = useHealth();
  if (!health?.login) return null;
  const logout = async () => {
    await api.logout().catch(() => undefined);
    router.push("/login");
  };
  return (
    <button
      onClick={() => void logout()}
      className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm text-muted transition-colors hover:bg-fill hover:text-foreground"
    >
      <IconLogout className="size-4" />
      退出
    </button>
  );
}
