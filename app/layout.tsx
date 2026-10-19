import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "../lib/sidebar";

export const metadata: Metadata = {
  title: "AutoTutorial AI",
  description: "Show it once. Get a tutorial automatically."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}