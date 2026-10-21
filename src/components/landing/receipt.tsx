import type { ReactNode } from "react";
import { MONO_FONT } from "./notebook";

// A till receipt: a white strip in a monospace face with dashed separators and a torn zigzag bottom edge.
// `teeth` is how many zigzag teeth the edge has; about one per 20px of width looks right.
function TornEdge({ teeth }: { teeth: number }) {
  const w = teeth * 20;
  let d = `M0 0h${w}v2`;
  for (let i = 0; i < teeth; i++) d += "l-10 8-10-8";
  d += "V0z";
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} 10`} preserveAspectRatio="none" className="block h-[10px] w-full">
      <path d={d} fill="#FFFFFF" />
    </svg>
  );
}

export function Receipt({
  children,
  teeth = 12,
  rotate = 0,
  filter,
  className = "",
  bodyClassName = "px-5 pb-4 pt-5 text-[13px] leading-[1.7]",
  tone = "text-[#15161A]",
}: {
  children: ReactNode;
  teeth?: number;
  rotate?: number;
  filter?: string;
  className?: string;
  bodyClassName?: string;
  tone?: string;
}) {
  return (
    <div className={className} style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined, filter }}>
      <div className={`bg-white ${MONO_FONT} ${tone} ${bodyClassName}`}>{children}</div>
      <TornEdge teeth={teeth} />
    </div>
  );
}

export function Rule({ gap = 8, bottom }: { gap?: number; bottom?: number }) {
  return <div className="border-t border-dashed border-[#9A9DA5]" style={{ margin: `${gap}px 0 ${bottom ?? gap}px` }} />;
}

export function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
