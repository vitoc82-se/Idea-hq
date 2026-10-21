import type { ReactNode } from "react";

// Small pieces of the landing page's "notebook" look. Colours: ink #15161A, pen #2446C8, highlighter #FFE45C.
// Everything here is decoration or plain text; the arrows and circles are hidden from screen readers.

export const PEN_FONT = "font-[family-name:var(--nb-pen)]";
export const MONO_FONT = "font-[family-name:var(--nb-mono)]";
export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2446C8]";

const turn = (deg: number) => (deg ? { transform: `rotate(${deg}deg)` } : undefined);

// A highlighter swipe behind a key phrase.
export function Highlight({ children }: { children: ReactNode }) {
  return (
    <span
      className="px-1 [box-decoration-break:clone]"
      style={{ background: "linear-gradient(transparent 58%, #FFE45C 58%, #FFE45C 92%, transparent 92%)" }}
    >
      {children}
    </span>
  );
}

// Handwritten text in pen blue, optionally tilted.
export function PenNote({ children, rotate = 0, className = "" }: { children: ReactNode; rotate?: number; className?: string }) {
  return (
    <span className={`${PEN_FONT} text-[#2446C8] ${className}`} style={turn(rotate)}>
      {children}
    </span>
  );
}

// The hand-drawn ring around a step number.
export function HandCircle({ n, d, size = 64 }: { n: number; d: string; size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none" className="absolute inset-0">
        <path d={d} stroke="#2446C8" strokeWidth={size < 48 ? 3.5 : 2.5} strokeLinecap="round" />
      </svg>
      <span className={`${PEN_FONT} font-semibold text-[#2446C8]`} style={{ fontSize: Math.round(size * 0.41) }}>{n}</span>
    </div>
  );
}

// A coloured paper note, slightly tilted, square corners.
export function StickyNote({ children, color, rotate = 0, dashed = false }: { children: ReactNode; color: string; rotate?: number; dashed?: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-[1_1_230px] flex-col gap-2 ${dashed ? "border-2 border-dashed border-[#9A9DA5] px-5 pb-[26px] pt-5" : "px-[22px] pb-7 pt-[22px] shadow-[0_8px_16px_rgba(21,22,26,0.10)]"}`}
      style={{ background: color, ...turn(rotate) }}
    >
      {children}
    </div>
  );
}

export function Underline({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="86" height="8" viewBox="0 0 86 8" fill="none" className={className}>
      <path d="M2 5c18-3 40-4 82-2" stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function CurvedArrow({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="120" height="90" viewBox="0 0 120 90" fill="none" className={className}>
      <path d="M10 6c6 34 34 60 92 70" stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M88 66l15 10-17 6" stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The arrow between two boxes in the safety flow. `d` is the shaft, so the two arrows can bend differently.
export function FlowArrow({ label, d }: { label: string; d: string }) {
  return (
    // Beside the boxes the arrow points right; on a phone the boxes stack, so it takes its own row and points down.
    <div aria-hidden="true" className="flex flex-none flex-col items-center justify-center px-1.5 max-[700px]:basis-full max-[700px]:flex-row max-[700px]:gap-2 max-[700px]:py-1">
      <span className={`${PEN_FONT} text-base font-medium text-[#2446C8]`}>{label}</span>
      <svg width="56" height="18" viewBox="0 0 56 18" fill="none" className="max-[700px]:rotate-90">
        <path d={d} stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M42 3l10 6-11 6" stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function CheckMark() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" className="flex-none">
      <path d="M4 13c3 2 5 4 6 6 3-6 6-10 11-15" stroke="#2446C8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
