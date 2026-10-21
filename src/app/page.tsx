import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { authOptions } from "@/lib/auth";
import { notebookSans, notebookPen } from "@/components/landing/fonts";
import { notebookMono } from "@/components/landing/mono-font";
import { CheckMark, CurvedArrow, FOCUS, FlowArrow, HandCircle, Highlight, MONO_FONT, PEN_FONT, PenNote, StickyNote, Underline } from "@/components/landing/notebook";
import { Receipt, Row, Rule } from "@/components/landing/receipt";

export const dynamic = "force-dynamic";

const TITLE = "Idea HQ: keep shipping your app";
const DESCRIPTION =
  "Write what you want next in plain words. Idea HQ plans it, an AI builds it in your own GitHub, and nothing changes until you approve it.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Idea HQ", title: TITLE, description: DESCRIPTION, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// The phone's browser bar matches the page's ink colour here. The signed-in app keeps its own colour.
export const viewport: Viewport = { themeColor: "#15161A", width: "device-width", initialScale: 1 };

const SECTION = "mx-auto w-full max-w-[1180px] px-6";
const H2 = "m-0 text-[clamp(34px,4.2vw,54px)] font-bold leading-[1.02] tracking-[-0.03em]";
const LEAD = "m-0 text-[19px] text-[#3B3E45]";
const NAV_LINK = `text-[#15161A] no-underline hover:underline hover:underline-offset-4 ${FOCUS}`;
const BUTTON_DARK = `inline-flex items-center rounded bg-[#15161A] font-semibold text-[#FAFAF7] no-underline hover:bg-[#2D2F34] ${FOCUS}`;
const BOX = "flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 rounded-md border-2 border-[#15161A] p-6";

const STEPS = [
  { d: "M33 6C17 5 6 17 7 33s14 26 28 25 23-12 22-27S45 6 30 9", title: "Write it down", text: "One line is enough. The AI sizes it and drafts a plan you can read and edit." },
  { d: "M30 7C15 8 5 20 7 35s16 24 30 22 22-14 20-28S44 6 28 10", title: "Approve the plan", text: "The AI builds it on a separate branch in your repo and runs your tests." },
  { d: "M34 6C18 6 6 18 8 34s15 25 29 23 21-13 20-27S46 7 31 9", title: "Review and merge", text: "Try the preview, ask for tweaks in plain words, then merge. Changed your mind? One button undoes it." },
] as const;

// Real runs on Idea HQ's own code.
const RECEIPTS = [
  { no: "#38", what: "Add a Help button", size: "1 file · 2 lines", cost: "$0.01", rotate: -2.5, className: "" },
  { no: "#39", what: "Learn the whole project", size: "44-line description", cost: "$0.17", rotate: 1.5, className: "mt-7" },
  { no: "#42", what: "Show the app version", size: "4 files · 41 lines", cost: "$0.21", rotate: -1, className: "mt-2" },
  { no: "#44", what: "Add profile pictures", size: "10 files · 427 lines", cost: "$0.74", rotate: 2.5, className: "mt-9" },
] as const;

const FAQ = [
  ["Do I need to know how to code?", "No. You need a GitHub account and an Anthropic or OpenAI API key. Setup takes about 10 minutes and the app walks you through it."],
  ["How is this different from Lovable?", "Lovable is great for starting an app. Idea HQ is for after: your app lives on GitHub, and every change is a pull request you approve."],
  ["And from Claude Code?", "Same models, different job. Claude Code is a developer tool for the terminal. Idea HQ is a notebook for ideas and bugs, with a review step anyone can use."],
  ["Can the AI break my app?", "Only if you merge something broken. Every change is a proposal, your tests must pass, and any merge can be undone."],
  ["Can I use ChatGPT instead?", "Yes. Pick OpenAI in setup and add an OpenAI API key (a ChatGPT subscription doesn't include one). Gemini support is coming soon."],
] as const;

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  // Signed-in people go straight to their ideas; everyone else gets the front door.
  if (session) redirect("/ideas");

  return (
    <div
      className={`${notebookSans.variable} ${notebookPen.variable} ${notebookMono.variable} relative min-h-screen overflow-hidden bg-[#FAFAF7] font-[family-name:var(--nb-sans)] text-[17px] leading-[1.55] text-[#15161A]`}
      style={{ backgroundImage: "linear-gradient(#E8EBF2 1px, transparent 1px), linear-gradient(90deg, #E8EBF2 1px, transparent 1px)", backgroundSize: "28px 28px" }}
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-[72px] w-0.5 bg-[#F1B5AE] max-[760px]:hidden" />

      <header className="relative">
        <nav aria-label="Main" className={`${SECTION} flex flex-wrap items-center justify-between gap-4 py-[22px]`}>
          <a href="#top" className={`flex flex-col text-[#15161A] no-underline ${FOCUS}`}>
            <span className="text-[22px] font-bold tracking-[-0.02em]">Idea HQ</span>
            <Underline />
          </a>
          <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1 text-base">
            <a href="#how" className={NAV_LINK}>How it works</a>
            <a href="#receipts" className={NAV_LINK}>Receipts</a>
            <a href="#safety" className={NAV_LINK}>Safety</a>
            <a href="#pricing" className={NAV_LINK}>Pricing</a>
            <Link href="/guide" className={NAV_LINK}>Guide</Link>
            <Link href="/auth/signin" className={`inline-flex min-h-[44px] items-center rounded border-2 border-[#15161A] px-[18px] font-semibold text-[#15161A] no-underline hover:bg-white ${FOCUS}`}>Sign in</Link>
          </div>
        </nav>
      </header>

      <main id="top" className="relative">
        <section aria-labelledby="hero-title" className={`${SECTION} flex flex-wrap items-center gap-16 pb-28 pt-[72px]`}>
          <div className="flex min-w-0 flex-[1_1_500px] flex-col gap-[26px]">
            <PenNote rotate={-2} className="self-start text-[19px] font-medium leading-[1.2]">early access, small batches</PenNote>
            <h1 id="hero-title" className="m-0 text-[clamp(44px,6vw,82px)] font-bold leading-[0.98] tracking-[-0.04em]">
              Keep shipping your app. <Highlight>Skip the code editor.</Highlight>
            </h1>
            <p className="m-0 max-w-[560px] text-xl leading-normal text-[#3B3E45]">
              Built your app with Lovable, Bolt or a freelancer? Write what you want next in plain words. Idea HQ plans it, an AI builds it in your own GitHub, and nothing changes until you approve it.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link href="/auth/signin?mode=register" className={`${BUTTON_DARK} min-h-[52px] px-[26px] text-[17px]`}>Request early access</Link>
              <a href="#demo" className={`inline-flex min-h-[52px] items-center px-2 font-semibold text-[#15161A] underline decoration-2 underline-offset-[5px] ${FOCUS}`}>Watch the 90-second demo</a>
            </div>
            <p className="m-0 text-[15px] text-[#55585F]">Free during early access. You pay Anthropic or OpenAI directly for the AI, usually cents per change.</p>
          </div>

          {/* A handwritten idea list and the receipt for one finished change. It is an illustration, so the buttons on it are not real. */}
          <div
            role="img"
            aria-label="Example: a handwritten list of ideas for a shop, and the receipt for one finished change, showing the app version in the footer: 4 files, 41 lines, build and tests passed, AI cost $0.21"
            className="relative flex min-h-[520px] min-w-0 flex-[1_1_420px] flex-col items-start gap-2"
          >
            <div aria-hidden="true" className="contents">
              <div className={`${PEN_FONT} pl-2 text-[21px] leading-[1.7] text-[#2446C8]`}>
                <div className="mb-1.5 text-2xl font-semibold">ideas for my shop</div>
                <div className="flex items-center gap-3"><span className="inline-block h-5 w-5 rounded-[3px] border-2 border-[#2446C8]" />dark mode switch</div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-[3px] border-2 border-[#2446C8] text-base leading-none">✓</span>
                  <span className="line-through decoration-2">show the app version in the footer</span>
                </div>
                <div className="flex items-center gap-3"><span className="inline-block h-5 w-5 rounded-[3px] border-2 border-[#2446C8]" />import my TODO list</div>
              </div>

              <CurvedArrow className="-mt-1 ml-[120px]" />

              <Receipt
                teeth={16}
                rotate={2}
                filter="drop-shadow(0 10px 18px rgba(21,22,26,0.14))"
                className="-mt-10 w-[330px] max-w-full self-end"
                bodyClassName="px-6 pb-[18px] pt-[22px] text-[13px] leading-[1.7]"
              >
                <div className="text-center font-semibold tracking-[0.12em]">IDEA HQ · CHANGE RECEIPT</div>
                <div className="mb-2.5 text-center text-[#55585F]">pull request #42</div>
                <Rule />
                <div>Show the app version in the footer</div>
                <Rule />
                <Row label="files changed" value="4" />
                <Row label="lines" value="41" />
                <Row label="build + tests" value="PASSED" />
                <Rule />
                <Row label="AI COST" value="$0.21" className="text-lg font-semibold" />
                <Rule gap={8} bottom={12} />
                <div className="flex gap-2">
                  <span className="inline-flex min-h-[44px] flex-1 items-center justify-center border-[1.5px] border-[#15161A] bg-white font-medium">Tweak</span>
                  <span className="inline-flex min-h-[44px] flex-1 items-center justify-center bg-[#15161A] font-semibold text-white">Merge</span>
                </div>
              </Receipt>

              <PenNote rotate={-3} className="ml-3 mt-2.5 self-start text-lg font-medium leading-[1.2]">← that&apos;s what it really cost</PenNote>
            </div>
          </div>
        </section>

        <section id="demo" aria-label="Product demo" className={`${SECTION} pb-28`}>
          <div className="box-border flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-md border-2 border-[#15161A] bg-white p-6 text-center">
            <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="29" stroke="#15161A" strokeWidth="2" />
              <path d="M26 20v24l19-12-19-12z" fill="#15161A" />
            </svg>
            <div className="text-xl font-bold">[90-SECOND DEMO VIDEO]</div>
            <PenNote className="text-lg font-medium">one line → plan → pull request → merge</PenNote>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className={`${SECTION} flex flex-col gap-12 pb-28`}>
          <h2 id="how-title" className={`${H2} max-w-[760px]`}>
            Three steps. <Highlight>You say yes to each one.</Highlight>
          </h2>
          <ol className="m-0 flex list-none flex-wrap gap-10 p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
                <HandCircle n={i + 1} d={s.d} />
                <h3 className="m-0 text-2xl font-bold tracking-[-0.01em]">{s.title}</h3>
                <p className="m-0 text-[#3B3E45]">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="receipts" aria-labelledby="receipts-title" className="relative bg-[#15161A] text-[#FAFAF7]">
          <div className={`${SECTION} flex flex-col gap-14 pb-28 pt-[104px]`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h2 id="receipts-title" className={`${H2} max-w-[640px]`}>Every change comes with a receipt.</h2>
              <p className="m-0 max-w-[420px] text-[#C9CBD1]">The real AI cost, straight from the provider. No credits, no markup. Set a monthly cap per project and new runs pause when you reach it.</p>
            </div>
            <ul className="m-0 flex list-none flex-wrap items-start justify-center gap-7 p-0">
              {RECEIPTS.map((r) => (
                <li key={r.no} className={`min-w-[220px] flex-[0_1_250px] ${r.className}`}>
                  <Receipt rotate={r.rotate}>
                    <div className="font-semibold tracking-[0.1em]">RECEIPT · {r.no}</div>
                    <Rule />
                    <div>{r.what}</div>
                    <div className="text-[#55585F]">{r.size}</div>
                    <Rule />
                    <Row label="TOTAL" value={r.cost} className="text-lg font-semibold" />
                  </Receipt>
                </li>
              ))}
            </ul>
            <p className={`${PEN_FONT} m-0 text-center text-lg font-medium text-[#FFE45C]`}>real runs on Idea HQ&apos;s own code. Claude runs show cost; OpenAI doesn&apos;t report it yet.</p>
          </div>
        </section>

        <section id="safety" aria-labelledby="safety-title" className={`${SECTION} flex flex-col gap-12 py-28`}>
          <div className="flex max-w-[720px] flex-col gap-3.5">
            <h2 id="safety-title" className={H2}>
              The AI can read your code. <Highlight>It can&apos;t write it.</Highlight>
            </h2>
            <p className={LEAD}>Every build runs in your own GitHub, in two separate steps. The one with your key can&apos;t write. The one that writes never sees your key.</p>
          </div>

          <div className="flex flex-wrap items-stretch gap-3">
            <div className={`${BOX} bg-white`}>
              <span className={`${MONO_FONT} text-[13px] tracking-[0.08em]`}>STEP 1 · THE AI</span>
              <span className="text-[21px] font-bold">Reads your repo, writes a patch</span>
              <PenNote className="text-base font-medium leading-[1.4]">has your key · read-only · can&apos;t open .env files</PenNote>
            </div>
            <FlowArrow label="patch" d="M3 10c14-4 30-4 48-1" />
            <div className={`${BOX} bg-white`}>
              <span className={`${MONO_FONT} text-[13px] tracking-[0.08em]`}>STEP 2 · THE BUILDER</span>
              <span className="text-[21px] font-bold">Applies it, runs your tests</span>
              <PenNote className="text-base font-medium leading-[1.4]">can write a branch · never sees your key</PenNote>
            </div>
            <FlowArrow label="PR" d="M3 9c14 3 30 3 48 0" />
            <div className={`${BOX} bg-[#FFE45C]`}>
              <span className={`${MONO_FONT} text-[13px] tracking-[0.08em]`}>STEP 3 · YOU</span>
              <span className="text-[21px] font-bold">Read it. Merge it. Or don&apos;t.</span>
              <span className="text-base text-[#15161A]">Tests must pass first. Any merge can be undone with one button.</span>
            </div>
          </div>

          <ul className="m-0 flex list-none flex-wrap gap-x-12 gap-y-3.5 p-0 text-[17px]">
            <li className="flex min-w-0 flex-[1_1_340px] gap-3"><CheckMark /><span><strong className="font-bold">Your code stays on GitHub.</strong> Idea HQ never hosts or copies your app.</span></li>
            <li className="flex min-w-0 flex-[1_1_340px] gap-3"><CheckMark /><span><strong className="font-bold">Your key stays in GitHub.</strong> We check it once, save it as a repo secret, and forget it.</span></li>
          </ul>
        </section>

        <section aria-labelledby="bugs-title" className={`${SECTION} flex flex-wrap items-center gap-14 pb-28`}>
          <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
            <h2 id="bugs-title" className={H2}>Prove the bug. Then fix it.</h2>
            <p className={LEAD}>Describe what goes wrong. The AI first writes a test that fails, then fixes the cause. If it can&apos;t reproduce the bug, it changes nothing and you get your run back.</p>
          </div>
          <div className="relative min-w-0 flex-[1_1_440px]">
            <div className={`${MONO_FONT} overflow-x-auto rounded-md border-2 border-[#15161A] bg-white px-6 py-[22px] text-[15px] leading-loose`}>
              <div className="text-[#B42318]">✗ discount code is ignored at checkout</div>
              <div className="pl-5 text-[#55585F]">reproduced with a failing test</div>
              <div className="text-[#1A7F37]">✓ discount code is ignored at checkout</div>
              <div className="pl-5 text-[#55585F]">fixed in src/lib/cart.ts · 1 file</div>
            </div>
            <PenNote rotate={-2} className="ml-6 mt-3.5 block text-lg font-medium">no repro? no change, run refunded</PenNote>
          </div>
        </section>

        <section aria-labelledby="more-title" className={`${SECTION} flex flex-col gap-9 pb-28`}>
          <h2 id="more-title" className="m-0 text-[34px] font-bold tracking-[-0.02em]">Also in the notebook</h2>
          <div className="flex flex-wrap gap-7">
            <StickyNote color="#FFF4A8" rotate={-1.5}>
              <h3 className="m-0 text-xl font-bold">Project knowledge</h3>
              <p className="m-0 text-base text-[#2D2F34]">See what the AI knows about your app, and correct it.</p>
            </StickyNote>
            <StickyNote color="#D9E6FF" rotate={1}>
              <h3 className="m-0 text-xl font-bold">Import your TODO list</h3>
              <p className="m-0 text-base text-[#2D2F34]">From a TODO.md, Notion or any list. The AI splits it into ideas.</p>
            </StickyNote>
            <StickyNote color="#FFDCD6" rotate={-0.5}>
              <h3 className="m-0 text-xl font-bold">A public What&apos;s new page</h3>
              <p className="m-0 text-base text-[#2D2F34]">Every merge drafts an entry. You reword it and publish.</p>
            </StickyNote>
            <StickyNote color="#FFFFFF" rotate={1.5} dashed>
              <PenNote className="text-base font-medium leading-[1.2]">coming soon</PenNote>
              <h3 className="m-0 text-xl font-bold">A Help button for your site</h3>
              <p className="m-0 text-base text-[#2D2F34]">Customer reports become bugs, and customers hear when they&apos;re fixed.</p>
            </StickyNote>
          </div>
          <p className="m-0 pt-2 text-base text-[#3B3E45]"><strong className="text-[#15161A]">Works with</strong> JavaScript and TypeScript on GitHub, with npm. Builds on Claude or OpenAI, with your own key. Gemini is coming soon.</p>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className={`${SECTION} flex flex-wrap items-center gap-14 pb-28`}>
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
            <h2 id="pricing-title" className={H2}>The price list is short.</h2>
            <p className={LEAD}>Free while we&apos;re in early access. Your AI usage is billed by Anthropic or OpenAI straight to your own key.</p>
          </div>
          <Receipt
            teeth={23}
            rotate={-1}
            filter="drop-shadow(0 12px 20px rgba(21,22,26,0.14))"
            className="min-w-0 flex-[1_1_460px]"
            bodyClassName="px-[30px] pb-[22px] pt-7 text-[15px] leading-[1.6]"
          >
            <div className="text-center text-base font-semibold tracking-[0.14em]">IDEA HQ · PRICE LIST</div>
            <Rule gap={14} />
            <Row label="FREE" value="€0" className="text-[17px] font-semibold" />
            <div className="text-sm text-[#55585F]">unlimited ideas + projects, daily AI estimates and plans</div>
            <Rule gap={14} />
            <div className="flex justify-between gap-4 text-[17px] font-semibold">
              <span><span className="px-[3px]" style={{ background: "linear-gradient(transparent 50%, #FFE45C 50%)" }}>PRO</span></span>
              <span>€9 / month</span>
            </div>
            <div className="text-sm text-[#55585F]">unlimited AI builds, higher daily limits · 99 kr in Sweden</div>
            <Rule gap={14} />
            <Row label="50 RUNS" value="€5 once" className="text-[17px] font-semibold" />
            <div className="text-sm text-[#55585F]">no subscription, failed runs refunded</div>
            <Rule gap={14} />
            <div className="text-center text-[13px] text-[#55585F]">revise, merge and undo are always free</div>
          </Receipt>
        </section>

        <section aria-labelledby="faq-title" className={`${SECTION} flex flex-col gap-7 pb-28`}>
          <h2 id="faq-title" className="m-0 text-[clamp(34px,4.2vw,54px)] font-bold tracking-[-0.03em]">Things people ask</h2>
          <div className="flex flex-wrap gap-x-14 gap-y-9">
            {FAQ.map(([q, a]) => (
              <div key={q} className="flex min-w-0 flex-[1_1_440px] flex-col gap-1.5">
                <h3 className={`${PEN_FONT} m-0 text-[21px] font-semibold text-[#2446C8]`}>{q}</h3>
                <p className="m-0 text-[#3B3E45]">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta-title" className="border-t-2 border-[#15161A] bg-white">
          <div className={`${SECTION} flex flex-col gap-7 pb-[104px] pt-24`}>
            <h2 id="cta-title" className="m-0 max-w-[820px] text-[clamp(38px,5vw,68px)] font-bold leading-none tracking-[-0.04em]">What&apos;s the first thing you&apos;d build?</h2>
            <form action="/auth/signin" method="get" className="flex max-w-[900px] flex-wrap items-end gap-4">
              <input type="hidden" name="mode" value="register" />
              <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
                <label htmlFor="first-idea" className="text-[15px] text-[#55585F]">Your first idea, in plain words</label>
                <input
                  id="first-idea"
                  name="idea"
                  type="text"
                  maxLength={200}
                  placeholder="add a dark mode switch to settings"
                  className={`${PEN_FONT} min-h-[56px] border-0 border-b-2 border-[#15161A] bg-transparent px-1 text-[22px] text-[#2446C8] outline-offset-4 placeholder:text-[#6B6E76] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2446C8]`}
                />
              </div>
              <button type="submit" className={`${BUTTON_DARK} min-h-[56px] cursor-pointer border-0 px-7 text-[17px]`}>Request early access</button>
            </form>
            <p className="m-0 text-[15px] text-[#55585F]">We&apos;re onboarding in small batches and read every idea.</p>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-[#DADDE3] bg-white">
        <div className={`${SECTION} flex flex-wrap justify-between gap-4 py-7 text-[15px] text-[#55585F]`}>
          <span>© 2026 Idea HQ</span>
          <div className="flex flex-wrap gap-x-[22px] gap-y-1">
            <Link href="/guide" className={NAV_LINK}>Guide</Link>
            <Link href="/guide#stuck" className={NAV_LINK}>Stuck?</Link>
            <Link href="/privacy" className={NAV_LINK}>Privacy</Link>
            <Link href="/terms" className={NAV_LINK}>Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
