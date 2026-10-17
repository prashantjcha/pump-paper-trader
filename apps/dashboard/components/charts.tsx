"use client";
// Chart primitives following the dataviz method: thin marks, recessive grid,
// one axis, legend for 2+ series, hover tooltip on every chart, text in ink tokens.
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, ReferenceLine, Legend,
  ScatterChart, Scatter, ZAxis,
} from "recharts";

const axisProps = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--ink)" },
  labelStyle: { color: "var(--ink-2)" },
  itemStyle: { color: "var(--ink)" },
};
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

export function TimeLines({ data, series, height = 240, yFmt = (v: number) => v.toFixed(3), baseline }: {
  data: Record<string, number | null>[]; series: { key: string; label: string; color: string }[];
  height?: number; yFmt?: (v: number) => string; baseline?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" {...axisProps}
          tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} minTickGap={40} />
        <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={yFmt} domain={["auto", "auto"]} />
        {baseline != null && <ReferenceLine y={baseline} stroke="var(--axis)" strokeDasharray="3 3" />}
        <Tooltip {...tooltipStyle} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v) => (typeof v === "number" ? yFmt(v) : String(v))} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />}
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Diverging bars: sign carries polarity (gain blue, loss red), zero baseline drawn. */
export function SignedBars({ data, x, y, height = 220, yFmt = (v: number) => v.toFixed(1), extra }: {
  data: Record<string, any>[]; x: string; y: string; height?: number; yFmt?: (v: number) => string; extra?: (d: any) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={x} {...axisProps} interval={0} fontSize={11} />
        <YAxis {...axisProps} axisLine={false} width={48} tickFormatter={yFmt} />
        <ReferenceLine y={0} stroke="var(--axis)" />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }}
          formatter={(v, _n, item) => [`${typeof v === "number" ? yFmt(v) : v}${extra ? " · " + extra(item.payload) : ""}`, y]} />
        <Bar dataKey={y} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={36}>
          {data.map((d, i) => <Cell key={i} fill={(d[y] ?? 0) >= 0 ? "var(--pos)" : "var(--neg)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Magnitude bars in one hue. */
export function Bars({ data, x, y, height = 200, color = "var(--series-1)", yFmt = (v: number) => String(v) }: {
  data: Record<string, any>[]; x: string; y: string; height?: number; color?: string; yFmt?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={x} {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={yFmt} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v) => (typeof v === "number" ? yFmt(v) : String(v))} />
        <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Price path of one token with our entry/exit marked. */
export function PricePath({ path, entry, exit, height = 260 }: { path: { t: number; price: number; is_buy: number; sol: number }[]; entry?: { t: number; price: number }; exit?: { t: number; price: number }; height?: number }) {
  const buys = path.filter((p) => p.is_buy).map((p) => ({ t: p.t, price: p.price, sol: p.sol }));
  const sells = path.filter((p) => !p.is_buy).map((p) => ({ t: p.t, price: p.price, sol: p.sol }));
  const fmt = (v: number) => v.toExponential(2);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} {...axisProps} tickFormatter={(t) => new Date(t).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })} minTickGap={40} />
        <YAxis dataKey="price" type="number" {...axisProps} axisLine={false} width={64} tickFormatter={fmt} domain={["auto", "auto"]} />
        <ZAxis dataKey="sol" range={[12, 90]} />
        <Tooltip {...tooltipStyle} labelFormatter={() => ""} formatter={(v, n) => (n === "t" ? new Date(Number(v)).toLocaleTimeString() : n === "price" ? fmt(Number(v)) : Number(v).toFixed(3))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Scatter name="buys" data={buys} fill="var(--series-1)" isAnimationActive={false} line={false} />
        <Scatter name="sells" data={sells} fill="var(--series-2)" isAnimationActive={false} />
        {entry && <ReferenceLine x={entry.t} stroke="var(--good-text)" strokeDasharray="4 3" label={{ value: "entry", fill: "var(--ink-2)", fontSize: 11, position: "top" }} />}
        {exit && <ReferenceLine x={exit.t} stroke="var(--critical)" strokeDasharray="4 3" label={{ value: "exit", fill: "var(--ink-2)", fontSize: 11, position: "top" }} />}
        {entry && <ReferenceLine y={entry.price} stroke="var(--axis)" strokeDasharray="2 4" />}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
