"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10 shrink-0 touch-manipulation sm:h-9 sm:w-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "라이트" : "다크 모드"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
