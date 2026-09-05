import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/next';
import "./globals.css";
import ConditionalLayout from "@/components/layout/ConditionalLayout";

// All routes require authentication, so there is nothing useful to prerender —
// disable static prerendering globally.
// (The "useRef of null" crash this comment used to blame was RH-32: `better-auth`
// was listed in `serverExternalPackages`, which split React during SSR. Fixed in
// next.config.ts; this directive is retained for the caching behaviour, not as a workaround.)
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Repertoire Hero",
  description: "Manage your music repertoire",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConditionalLayout>
          {children}
        </ConditionalLayout>
        <Analytics />
      </body>
    </html>
  );
}
