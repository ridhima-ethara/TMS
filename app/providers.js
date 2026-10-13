'use client';

// Client-only context wrapper. QueryClient is created once at module load.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }) {
  return (
    // `disableTransitionOnChange` is intentionally off: the colour crossfade is
    // driven by the short-lived `.theme-transitioning` class that ThemeToggle
    // adds, which keeps the swap smooth without leaving a permanent transition
    // on every element in the large table views.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="ethara-theme"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
