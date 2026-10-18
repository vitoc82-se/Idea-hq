# Backlog (in priority order)

- [ ] Support widget cosmetic tweaks: collect the visual tweaks Niklas wants for the Help button, widget, ticket page and inbox, then apply them.
- [ ] Swedish widget: translate the Help widget, ticket page and customer emails, chosen per project (Findmeajob is Swedish-first).
- [ ] Bring the app's accent green to the accessible shade (#047857) for text, links and filled buttons on every existing screen; one accent token documented in DESIGN.md.
- [ ] Phone polish for support: pin the widget's send button above the on-screen keyboard and make the inbox reply box sticky.
- [ ] Per-project daily and monthly spend caps: refuse new runs once a project exceeds its budget; needs real cost data from runs.
- [ ] Unanswered-ticket nudge: email the owner when a ticket has waited for a reply longer than a chosen time.
- [ ] Auto-close tickets after N days of customer silence, with a polite last email.
- [ ] Import polish: estimate imported ideas in one go, and re-import only new items from a TODO file that changes.
- [ ] Estimate cost for OpenAI runs from token usage, like the Claude cost display (only if the logs expose token counts).
- [ ] Gemini and Grok run engines behind the provider interface (only when someone has those keys).
- [ ] Ticket attachments (screenshots): private storage, size and type limits, virus scan, expiring links.
- [ ] Reply to tickets by email: inbound mail provider, per-ticket reply address, quote stripping, spam filtering.
- [ ] Store users' provider keys encrypted (envelope encryption, audit log, rotation); only if helper calls must run on users' own keys.
- [ ] Ticket extras: assignment, canned replies, response-time timers and analytics.
