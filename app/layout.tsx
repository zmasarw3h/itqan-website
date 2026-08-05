import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITQAN",
  description: "Halaqa learning and operations system for students, teachers, and masjid administrators."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
