import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITQAN Daily Check-In",
  description: "Emergency daily check-in system for ITQAN students."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
