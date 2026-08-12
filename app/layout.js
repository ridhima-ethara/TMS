import './globals.css'
import { Providers } from './providers'

export const metadata = {
  title: 'Ethara Service Hub — IT & Admin Operations',
  description: 'Tickets, approvals, tasks and checklists with SLA and audit trails.',
  icons: { icon: '/brand/ethara-emblem.png', apple: '/brand/ethara-emblem.png' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
