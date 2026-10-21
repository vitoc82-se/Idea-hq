# Idea HQ landing page: build handoff ("The notebook")

Replace the public start page (`/`) with the design in `ideahq-landing-reference.html`. That file is the source of truth for layout, copy and colours. Open it in a browser next to your work and match it.

Only the public landing page changes. Leave `/guide`, `/auth/*`, the app screens and the API alone.

## Files

| File | What it is |
| --- | --- |
| `ideahq-landing-reference.html` | The finished design as one static page, all styles inline. Copy every word from here. |
| `ideahq-landing-handoff.md` | This brief: tokens, components, sections and the definition of done. |

## Build approach

1. Look at how the current landing page is built (route, layout, styling approach) and follow the repo's conventions. Don't add a CSS framework or UI library.
2. Load the three fonts with `next/font/google` (or the repo's existing font setup), not a `<link>` tag.
3. Turn the repeated pieces into small components (list below). Convert the inline styles into whatever the repo uses (CSS modules, Tailwind, etc.).
4. Keep all copy exactly as in the reference. Do not invent new numbers, features or claims.
5. Update the page `<title>`, meta description and `theme-color` (now `#047857`, change to `#15161A`).

## Design tokens

| Token | Value | Used for |
| --- | --- | --- |
| `paper` | `#FAFAF7` | Page background |
| `grid` | `#E8EBF2` | Graph-paper lines, 1px every 28px |
| `margin` | `#F1B5AE` | Red margin line, 2px, 72px from the left; hidden below 760px |
| `ink` | `#15161A` | Text, borders, primary buttons, receipts band |
| `ink-2` | `#3B3E45` | Body text |
| `ink-3` | `#55585F` | Secondary text, receipt sub-lines |
| `rule` | `#9A9DA5` | Dashed receipt separators |
| `pen` | `#2446C8` | Handwritten notes, arrows, hand-drawn circles |
| `highlight` | `#FFE45C` | Highlighter swipe behind key phrases |
| `card` | `#FFFFFF` | Receipts, boxes, CTA band |
| `sticky-yellow` / `sticky-blue` / `sticky-pink` | `#FFF4A8` / `#D9E6FF` / `#FFDCD6` | "Also in the notebook" cards |
| `fail` / `pass` | `#B42318` / `#1A7F37` | Test output lines |

Radius is small on purpose: 4px on buttons, 6px on boxes, 0 on receipts and sticky notes.

## Typography

| Role | Font | Notes |
| --- | --- | --- |
| Headlines and body | Familjen Grotesk 400–700 | H1 `clamp(44px, 6vw, 82px)`, letter-spacing −0.04em; H2 `clamp(34px, 4.2vw, 54px)` |
| Pen notes | Shantell Sans 400–600 | Always in `pen` colour, 16–26px, often rotated −2° to −4° |
| Receipts and labels | IBM Plex Mono 400–600 | 13–15px; totals 18px semibold |

## Components to extract

- **`<Highlight>`**: inline span with a highlighter band, `linear-gradient(transparent 58%, highlight 58%, highlight 92%, transparent 92%)`, 4px side padding.
- **`<PenNote>`**: Shantell Sans text in `pen` colour with an optional rotation prop.
- **`<Receipt>`**: white strip, mono text, dashed separators, a zigzag torn bottom edge (the inline SVG in the reference), optional rotation and drop shadow. Used in the hero, the receipts wall (×4) and pricing.
- **`<HandCircle>`**: the hand-drawn circle around step numbers 1–3 (SVG paths in the reference).
- **`<StickyNote>`**: coloured card, slight rotation, soft shadow.
- **Arrows**: the hand-drawn SVG arrows in the hero and safety flow. Keep them as decorative SVG.

## Sections, in order

1. **Nav**: wordmark with pen underline; links to `#how`, `#receipts`, `#safety`, `#pricing`, `/guide`; "Sign in" goes to `/auth/signin`.
2. **Hero**: headline with highlight; subline; "Request early access" goes to `/auth/signin?mode=register`; "Watch the 90-second demo" goes to `#demo`. On the right: a handwritten idea list, an arrow, and the change receipt ($0.21).
3. **Demo** (`#demo`): 16:9 placeholder box. Leave it as is until the video exists, then swap in the video.
4. **How it works** (`#how`): three steps with hand-circled numbers.
5. **Receipts wall** (`#receipts`): black band with four receipts. These are real runs: $0.01, $0.17, $0.21, $0.74.
6. **Safety** (`#safety`): AI → patch → builder → PR → you, plus two check-mark lines.
7. **Bugs**: failing-then-passing test output with a pen note.
8. **Also in the notebook**: three sticky notes, one dashed "coming soon" card, then the "Works with" line.
9. **Pricing** (`#pricing`): the price-list receipt: Free €0, Pro €9/month (99 kr), 50 runs €5 once.
10. **FAQ**: five questions, with questions styled as pen notes.
11. **Final CTA**: "What's the first thing you'd build?", a labelled text input and a "Request early access" button.
12. **Footer**: Guide, Stuck?, Privacy, Terms.

## Behaviour

- **Final CTA form**: send the visitor to `/auth/signin?mode=register&idea=<their text>`. If the sign-up flow can carry that idea into their first project, that's a nice bonus. Ask before building it.
- **Hero mock buttons**: "Tweak" and "Merge" on the hero receipt are illustration only. Render them as non-focusable, decorative elements (`aria-hidden`, not real buttons) so keyboard users don't tab into a fake UI.
- **Privacy and Terms links**: if `/privacy` or `/terms` don't exist yet, keep the links and tell me. Don't create legal text.
- **No animation needed.** If you add any, respect `prefers-reduced-motion`.

## Responsive rules

- Content max width 1180px with a 24px side gutter.
- Every multi-column row wraps to one column on a phone (the reference uses `flex-wrap` with flex-basis; keep that behaviour).
- Hide the margin line below 760px.
- Receipts keep their rotation on phones, but must never cause horizontal scrolling.
- Check at 390px, 768px and 1440px.

## Definition of done

- [ ] `/` matches the reference at 1440px and 390px.
- [ ] No horizontal scroll at 390px.
- [ ] All text meets 4.5:1 contrast. Decorative SVGs have `aria-hidden="true"`.
- [ ] Fonts load through `next/font` with no layout shift.
- [ ] Typecheck, build and tests pass.
- [ ] Nothing outside the landing page and its new components changed.
