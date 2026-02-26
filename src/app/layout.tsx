import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'branch-review | reviewctl Dashboard',
  description:
    'Multi-agent code review orchestration dashboard for reviewctl workflows.',
  keywords: [
    'branch-review',
    'reviewctl',
    'code review',
    'Next.js',
    'TypeScript',
    'shadcn/ui',
  ],
  authors: [{ name: 'branch-review maintainers' }],
  openGraph: {
    title: 'branch-review',
    description:
      'Orchestrate multi-agent branch and PR reviews from a web dashboard.',
    siteName: 'branch-review',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'branch-review',
    description: 'reviewctl dashboard for multi-agent branch reviews.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
