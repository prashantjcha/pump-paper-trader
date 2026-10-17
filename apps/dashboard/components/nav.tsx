"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  ["/", "Overview"], ["/trades", "Trades"], ["/market", "Market"], ["/wallets", "Wallets"], ["/calls", "Calls"], ["/learning", "Learning"], ["/system", "System"],
] as const;

export function Nav() {
  const path = usePathname();
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    try { const t = localStorage.getItem("theme"); if (t) { document.documentElement.dataset.theme = t; setTheme(t); } } catch { /* storage blocked */ }
  }, []);
  const toggle = () => {
    const cur = theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
  };
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 overflow-x-auto px-4 py-2">
        <span className="mr-3 whitespace-nowrap text-sm font-semibold">Pump Paper Trader</span>
        {LINKS.map(([href, label]) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              {label}
            </Link>
          );
        })}
        <span className="flex-1" />
        <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs text-ink-2">paper mode · no keys</span>
        <button onClick={toggle} className="ml-2 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2" aria-label="Toggle theme">Theme</button>
      </div>
    </header>
  );
}
