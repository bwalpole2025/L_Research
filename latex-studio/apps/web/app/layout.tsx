import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppDialog } from '@/components/AppDialog';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500-italic.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'LaTeX Studio',
  description: 'A single-user, locally-hosted LaTeX editor.',
};

// Set the theme class before paint to avoid a flash of the wrong theme.
const THEME_BOOTSTRAP = `
try {
  var t = localStorage.getItem('latex-studio:theme');
  var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="bg-[var(--ls-bg)] text-zinc-950 antialiased dark:text-zinc-100">
        {children}
        <AppDialog />
      </body>
    </html>
  );
}
