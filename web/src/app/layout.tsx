import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { site } from "@/lib/site";

// Root layout = <html>/<body>/fonts/metadata ONLY. Storefront chrome lives in
// app/(site)/layout.tsx, back-office chrome in app/admin/(console)/layout.tsx.

// Thai = IBM Plex Sans Thai (OFL), self-hosted Thai-subset files, every face limited to the Thai block + ZWNJ/ZWJ + dotted
// circle. It is FIRST in --font-sans (globals.css), so Thai is always Plex on every browser (Safari's -apple-system would
// otherwise cascade Thai to Thonburi/Sukhumvit), while Latin text, digits and punctuation fall through to the system
// font (SF on Apple, Segoe UI on Windows, Roboto on Android). ฿ (U+0E3F) is in the Thai block, so it is Plex.
const thai = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-thai-thai-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-700.woff2", weight: "700", style: "normal" },
  ],
  // Thai block + ZWNJ/ZWJ + dotted circle (next/font options must be literals)
  declarations: [{ prop: "unicode-range", value: "U+0E00-0E7F, U+200C-200D, U+25CC" }],
  display: "swap",
  // the generated metric-adjusted fallback face is local(Arial) WITHOUT a unicode-range, so it would capture Latin text
  // ahead of the system font — keep the stack clean instead
  adjustFontFallback: false,
  variable: "--ff-thai",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    locale: site.locale,
    siteName: site.name,
    title: site.title,
    description: site.description,
  },
  twitter: { card: "summary_large_image", title: site.title, description: site.description },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Search Console ownership token (deploy env); omitted when unset
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${thai.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
