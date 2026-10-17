"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function usePoll<T>(url: string, everyMs = 5000): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const load = async () => {
    try {
      const r = await fetch(urlRef.current, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j); setError(null);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, everyMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, everyMs]);
  return { data, error, reload: load };
}

export function Card({ title, sub, children, className = "", right }: { title?: string; sub?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "pos" | "neg" | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === "pos" ? "text-good" : tone === "neg" ? "text-critical" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="py-16 text-center text-sm text-muted">{error ? `Could not load: ${error}` : "Loading…"}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted">{children}</div>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const c = tone === "good" ? "text-good border-good/30" : tone === "bad" ? "text-critical border-critical/30" : tone === "warn" ? "text-ink border-[var(--warning)]" : "text-ink-2 border-line";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${c}`}>{children}</span>;
}

// ---- formatting
export const sol = (v: number | null | undefined, d = 4) => (v == null ? "–" : `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(d)}`);
export const signedSol = (v: number | null | undefined, d = 4) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)} SOL`);
export const pct = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
export const ratio = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "–" : v.toFixed(d));
export const tone = (v: number | null | undefined) => (v == null ? null : v > 0 ? "pos" : v < 0 ? "neg" : null);
export const ago = (ms: number | null | undefined) => {
  if (!ms) return "–";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
export const dur = (s: number | null | undefined) => (s == null ? "–" : s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(1)}h`);
export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "–");
export const PnlText = ({ v, children }: { v: number | null | undefined; children: ReactNode }) => (
  <span className={v == null ? "" : v > 0 ? "text-good" : v < 0 ? "text-critical" : ""}>{children}</span>
);
