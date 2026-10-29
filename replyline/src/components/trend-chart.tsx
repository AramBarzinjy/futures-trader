/**
 * Single-series weekly bar chart. One hue (brand teal, 3.7:1 on white),
 * thin bars with rounded data-ends on a baseline, recessive gridline,
 * per-bar hover/focus tooltip, and a screen-reader table of the same data.
 */
export function TrendChart({ data, label }: { data: { label: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const H = 140;
  return (
    <figure>
      <div className="relative" style={{ height: H + 24 }} aria-hidden>
        <div className="absolute inset-x-0 border-t border-dashed border-ink-200" style={{ top: 0 }} />
        <div className="absolute right-0 -top-2 bg-white pl-1 text-[11px] tabular-nums text-ink-400">{max}</div>
        <div className="absolute inset-x-0 border-t border-ink-300" style={{ top: H }} />
        <div className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ height: H }}>
          {data.map((d) => (
            <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0}>
              <div
                className="w-full max-w-9 rounded-t-[4px] bg-brand-600 transition-colors group-hover:bg-brand-700 group-focus:bg-brand-700"
                style={{ height: Math.max(d.count ? 3 : 0, (d.count / max) * H) }}
              />
              <div className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md bg-ink-950 px-2 py-1 text-xs text-white shadow group-hover:block group-focus:block">
                Week of {d.label}: <span className="font-semibold tabular-nums">{d.count}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 flex gap-[2px]" style={{ top: H + 6 }}>
          {data.map((d, i) => (
            <div key={d.label} className="flex-1 text-center text-[11px] text-ink-500">
              {i % 2 === 0 || data.length <= 6 ? d.label : ""}
            </div>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Week starting</th>
            <th>New enquiries</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
