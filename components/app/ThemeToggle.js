"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Paints the colour swap as one smooth crossfade.
 *
 * A permanent `transition` on every element would tax the large table views
 * (Firewall, Tickets), so the transition is switched on only for the duration
 * of the swap and torn down straight after.
 */
function runThemeTransition(apply) {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (reduceMotion) {
    apply();
    return;
  }

  root.classList.add("theme-transitioning");
  apply();
  window.clearTimeout(runThemeTransition._timer);
  runThemeTransition._timer = window.setTimeout(() => {
    root.classList.remove("theme-transitioning");
  }, 320);
}

/**
 * Theme switcher. Renders a single button that advances light -> dark ->
 * system, with the resolved icon animating on change.
 */
export default function ThemeToggle({ className = "" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The stored theme is unknown during SSR, so the icon is only meaningful
  // after mount. Rendering a stable placeholder avoids a hydration mismatch.
  useEffect(() => setMounted(true), []);

  const cycle = useCallback(() => {
    const order = MODES.map((m) => m.value);
    const next = order[(order.indexOf(theme) + 1) % order.length];
    runThemeTransition(() => setTheme(next));
  }, [theme, setTheme]);

  const active = MODES.find((m) => m.value === theme) || MODES[2];
  const Icon = mounted
    ? active.value === "system"
      ? Monitor
      : active.Icon
    : Sun;

  const label = mounted
    ? active.value === "system"
      ? `System theme (currently ${resolvedTheme === "dark" ? "dark" : "light"})`
      : `${active.label} theme`
    : "Theme";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={cycle}
            aria-label={`${label}. Activate to change theme.`}
            className={`theme-toggle relative overflow-hidden ${className}`}
          >
            <Icon
              key={mounted ? active.value : "placeholder"}
              className="theme-toggle-icon h-4 w-4"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{label}</p>
          <p className="text-[10px] opacity-70">Click to switch</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
