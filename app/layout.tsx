import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITQAN App",
  description: "System for ITQAN halaqa students."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
