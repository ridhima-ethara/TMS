import './globals.css'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from './providers'

// Self-hosted at build time (the CSP blocks third-party font hosts).
const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-geist', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist-mono', display: 'swap' })

export const metadata = {
  title: 'Ethara Service Hub — IT & Admin Operations',
  description: 'Tickets, approvals, tasks and checklists with SLA and audit trails.',
  icons: { icon: '/brand/ethara-emblem.png', apple: '/brand/ethara-emblem.png' },
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#12141b' },
  ],
}

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: next-themes resolves the stored theme on the
    // client and writes the class onto <html>, so the server markup for this
    // element legitimately differs from the first client render.
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
