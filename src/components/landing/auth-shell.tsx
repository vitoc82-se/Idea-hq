import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS, Highlight, PenNote, Underline } from "./notebook";

// The frame for the sign-in screens: the start page's graph paper, margin line and ink-and-pen look, in the light
// colours whatever theme the app is set to. Colours are written out (not the theme variables) for that reason.
// The text face comes from the root layout (--nb-sans).
export const AUTH_INPUT =
  "min-h-[48px] w-full rounded border-2 border-[#15161A] bg-white px-3 text-[17px] text-[#15161A] placeholder:text-[#6B6E76] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2446C8]";
export const AUTH_BUTTON = `inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded border-0 bg-[#15161A] px-6 text-[17px] font-semibold text-[#FAFAF7] hover:bg-[#2D2F34] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const AUTH_BUTTON_QUIET = `inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded border-2 border-[#15161A] bg-white px-6 text-[17px] font-semibold text-[#15161A] hover:bg-[#FAFAF7] ${FOCUS}`;
export const AUTH_LINK = `cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#2446C8] underline underline-offset-4 hover:text-[#15161A] ${FOCUS}`;

export function AuthLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-medium text-[#3B3E45]">
      {children}
    </label>
  );
}

// `note` is the handwritten line above the heading, `highlight` the part of the heading that gets the highlighter.
export function AuthShell({
  title,
  highlight,
  note,
  intro,
  children,
}: {
  title: string;
  highlight?: string;
  note?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const [before, after] = highlight && title.includes(highlight) ? title.split(highlight) : [title, ""];
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#FAFAF7] font-[family-name:var(--nb-sans)] text-[17px] leading-[1.55] text-[#15161A]"
      style={{ backgroundImage: "linear-gradient(#E8EBF2 1px, transparent 1px), linear-gradient(90deg, #E8EBF2 1px, transparent 1px)", backgroundSize: "28px 28px" }}
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-[72px] w-0.5 bg-[#F1B5AE] max-[760px]:hidden" />

      <header className="relative mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-6 py-[22px]">
        <Link href="/" className={`flex flex-col text-[#15161A] no-underline ${FOCUS}`}>
          <span className="text-[22px] font-bold tracking-[-0.02em]">Idea HQ</span>
          <Underline />
        </Link>
        <Link href="/guide" className={`text-base text-[#15161A] no-underline hover:underline hover:underline-offset-4 ${FOCUS}`}>Guide</Link>
      </header>

      <main className="relative mx-auto flex w-full max-w-[520px] flex-col gap-6 px-6 pb-20 pt-8">
        <div className="flex flex-col gap-4">
          {note && <PenNote rotate={-2} className="self-start text-[19px] font-medium leading-[1.2]">{note}</PenNote>}
          <h1 className="m-0 text-[clamp(38px,8vw,52px)] font-bold leading-[1] tracking-[-0.03em]">
            {highlight && title.includes(highlight) ? <>{before}<Highlight>{highlight}</Highlight>{after}</> : title}
          </h1>
          {intro && <p className="m-0 text-base text-[#3B3E45]">{intro}</p>}
        </div>
        <div className="rounded-md border-2 border-[#15161A] bg-white p-7">{children}</div>
      </main>
    </div>
  );
}
