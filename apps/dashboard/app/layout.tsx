import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Pump Paper Trader",
  description: "Analytics for the pump.fun paper-trading bot and its learning loop",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Nav />
        <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-4">{children}</main>
      </body>
    </html>
  );
}
