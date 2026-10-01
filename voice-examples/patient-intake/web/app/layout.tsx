import type { Metadata } from 'next';

import { cn } from '@/lib/utils';
import { displayFont, monoFont, sansFont } from '@/lib/fonts';
import '@/styles/tailwind.css';

export const metadata: Metadata = {
  title: 'LiveKit reference agents',
  description: 'Try a LiveKit reference voice agent in your browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-lk-theme` is what the bytes-core token layer switches on; dark is the default for
    // LiveKit product surfaces. There is no theme toggle here — the marketing site owns that
    // and this app is a single embedded demo.
    <html lang="en" data-lk-theme="dark" suppressHydrationWarning>
      <body
        className={cn(
          sansFont.variable,
          monoFont.variable,
          displayFont.variable,
          'bg-bg1 text-fg1 font-sans antialiased',
        )}
      >
        {children}
      </body>
    </html>
  );
}
