import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO Command Center - Bloomberg Terminal for Brand Visibility",
  description: "Next-generation dashboard for Generative Engine Optimization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}

