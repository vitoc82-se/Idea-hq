# Design system

Idea HQ keeps one small visual language. This file records it so new screens, especially the
public support widget, stay consistent. Calibrated to the code in `src/components/ui/*`.

## Foundations
- Font: Geist (variable). Widget and ticket page use the system UI stack so they load with no
  font request inside a customer's site.
- Colour: Tailwind gray scale plus emerald. Cards are white on gray-50; dark mode uses gray-800 on slate-900.
- Radius: 8px controls (`rounded-lg`), 12px cards and the widget panel.
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
- Persuade surface: left-aligned headline, one sentence of support, one primary action (Create account) and a quiet Sign in link. Anything that sets expectations (invite-only) sits directly under the buttons in 14px, not in the footer.
- Shows the product with a plain-HTML example (idea, plan, change) instead of icons or stock art. Sections: How it works (numbered steps), You stay in control. No icon tiles, no card grid.
- Filled buttons use emerald-700 (white text 5.5:1); header links are 44px tall.
