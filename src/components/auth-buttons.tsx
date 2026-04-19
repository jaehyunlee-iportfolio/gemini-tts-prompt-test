"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthButtons() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <span className="text-xs text-muted-foreground">로딩중…</span>;
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span
        className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline sm:max-w-[12rem]"
        title={session.user.email ?? undefined}
      >
        {session.user.email}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 shrink-0 touch-manipulation gap-1 px-2.5 text-xs sm:h-8 sm:text-xs"
        onClick={() => void signOut({ callbackUrl: "/login" })}
      >
        <LogOut className="h-3.5 w-3.5" />
        로그아웃
      </Button>
    </div>
  );
}
