import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// Electron's <webview> tag, used by the Preview tab.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string; allowpopups?: string }
    }
  }
}
