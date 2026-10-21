# Design system

Idea HQ keeps one small visual language. This file records it so new screens, especially the
public support widget, stay consistent. Calibrated to the code in `src/components/ui/*`.

## Foundations
- Two themes, light and dark, chosen with the Light / Dark switch in the menu (stored in the browser as
  `ideahq-theme`; the first visit follows the device). `<html data-theme>` is set by a script in the page head
  before first paint (`src/lib/theme.ts`). Tailwind's `dark:` variant keys on `data-theme="dark"`; `light:` keys on
  everything else.
- Colour comes from CSS variables (`src/app/globals.css`): the `gray` and `emerald` scales are variable-backed in
  `tailwind.config.ts`. Dark = the original Tailwind palette (cards gray-800 on slate-900). Light = the notebook look of
  the start page: paper `#FAFAF7` with graph-paper lines, ink `#15161A` (filled buttons, outlines), pen blue `#2446C8`
  (links, accents), highlighter yellow tints. Inside `.nb-skin` (the signed-in app, the Guide) the light theme also
  gives ink buttons, 4px controls, 6px ink-outlined boxes and the notebook typeface.
- Sign-in screens (sign in, change password, confirm email) and the start page are always light: they write their
  colours out and use `AuthShell` / the landing components in `src/components/landing/`.
- Font: dark = system UI stack. Light and public pages = Familjen Grotesk (text) and Shantell Sans (handwritten
  notes), loaded with `next/font/google` in the root layout. Widget and ticket page use the system UI stack so they
  load with no font request inside a customer's site.
- Radius: dark 8px controls (`rounded-lg`) and 12px cards; light 4px controls and 6px boxes.
- Focus: every control shows a 2px ring (`focus-visible:ring-2 ring-emerald-500`, offset 2px).
- Spacing: 4px base; page gutters 16px (phones) to 32px.

## Accent and contrast rules
- Text 4.5:1 against its background, UI borders and icons 3:1.
- New screens use accent `#047857` (emerald-700, 5.48:1 with white). The older app green `#059669`
  is 3.77:1 and is not used for text or filled buttons on new screens (see TODOS.md).
- Owner-chosen brand colours in the widget are auto-darkened until white text on them reaches 4.5:1
  (`src/lib/support/contrast.ts`). In dark mode a lightened variant is used for links.
- Colour never carries meaning alone: statuses are words, the AI tag is the words "AI answer".

## Widget (customer-facing, public)
- Desktop: 380 x 560 panel floating bottom-right, 20px from the edges, 12px radius.
- Phones (under 480px): full-screen sheet, close button top-left, page behind does not scroll.
- Launcher: pill button labelled "Help", 48px tall, bottom-right (or left via `data-position`).
- Every field has a visible label above it; "required" is written in words; placeholders are examples only.
- Tap targets 44px minimum. Escape closes and returns focus to the launcher.
- Motion: one short fade on open, disabled for `prefers-reduced-motion`.
- AI answers carry a plain text tag "AI answer" (no icon) and the line
  "Based on our help notes. Not what you needed? Contact us".
- Footer: small "Powered by Idea HQ" link.

## Owner screens
- Sidebar item "Support" with an unread badge; one inbox across projects.
- Inbox: two panes on desktop (list + ticket), list-then-ticket screens on phones.
- Status vocabulary (same words everywhere): Open, Waiting for customer, Resolved, Closed.
- Settings per project live on the project's "Support" page: form fields, embed code, help notes, AI and limits, branding.

## Copy
Plain everyday language. No internal terms (no "knowledge", "context", "run") on customer-facing screens.

## Start page (public landing, `/`)
- Persuade surface in two tones: a near-black hero (`#0B1310`, mint accent `#34D399`) with the headline, one sentence, Create account and Sign in, and the invite-only note directly under the buttons; then a light product section.
- Shows the product with plain-HTML examples (a finished change with its diff, and an ideas board) instead of icons or stock art. No icon tiles, no feature-card grid, no gradients. Steps are Write, Approve, Merge as large words with a sentence each.
- Dark hero buttons are mint with dark text; light-section buttons use emerald-700 (white text 5.5:1). Tap targets are 44px or more. Under 420px the header drops the Guide link (it stays in the footer).
- Every public page sets its own title (template `%s · Idea HQ`), description and canonical address. The social preview is `src/app/opengraph-image.tsx`; icons are the rocket on emerald in `public/icons` and `src/app/favicon.ico`.

## What's new page (public, per project)
- Neutral and quiet: one column, project name as the title, entries grouped by month. A type word (New, Fixed, Improved) in an outlined pill, the date, a bold title, optional plain details. No Idea HQ navigation, no accent colour, no images. The only brand mark is a small "Powered by Idea HQ" line.
- Shared links use a dark card with the project name and the latest titles (`opengraph-image.tsx` next to the page).
