import crypto from "crypto";
import { accentForDarkBackground, accentForWhiteText } from "./contrast";
import { escapeHtml } from "./sanitize";

// Shared pieces for the server-built public pages (widget, help page, ticket page,
// embed script). These pages are plain HTML + a small script: no React and no
// app code, so nothing from the owner's app can leak into them. Customer text is
// only ever placed with textContent in the browser.

export function newNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function securityHeaders(opts: { nonce: string; frameAncestors: string[]; turnstile: boolean; contentType?: string }): Record<string, string> {
  const ts = opts.turnstile ? " https://challenges.cloudflare.com" : "";
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${opts.nonce}'${ts}`,
    `style-src 'nonce-${opts.nonce}'`,
    "img-src https: data:",
    "connect-src 'self'",
    opts.turnstile ? "frame-src https://challenges.cloudflare.com" : "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${opts.frameAncestors.length ? opts.frameAncestors.join(" ") : "'none'"}`,
  ].join("; ");
  return {
    "Content-Type": opts.contentType || "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

export type Brand = { title: string; brandColor: string; logoUrl: string | null; theme: string };

export function themeCss(b: Brand): string {
  const accent = accentForWhiteText(b.brandColor);
  const link = accentForDarkBackground(b.brandColor);
  return `
:root{--bg:#fff;--surface:#f9fafb;--fg:#111827;--muted:#4b5563;--border:#6b7280;--soft:#d1d5db;--accent:${accent};--link:${accent};--tagbg:#ecfdf5;--tagfg:#065f46;--err:#b91c1c;--input:#fff;color-scheme:light}
@media (prefers-color-scheme:dark){:root[data-theme=auto]{--bg:#111827;--surface:#1f2937;--fg:#f9fafb;--muted:#d1d5db;--border:#9ca3af;--soft:#374151;--link:${link};--tagbg:#064e3b;--tagfg:#a7f3d0;--err:#fca5a5;--input:#111827;color-scheme:dark}}
:root[data-theme=dark]{--bg:#111827;--surface:#1f2937;--fg:#f9fafb;--muted:#d1d5db;--border:#9ca3af;--soft:#374151;--link:${link};--tagbg:#064e3b;--tagfg:#a7f3d0;--err:#fca5a5;--input:#111827;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
h1{font-size:17px;line-height:1.3;margin:0;font-weight:650}
h2{font-size:16px;margin:0 0 8px;font-weight:650}
p{margin:0 0 12px}
a{color:var(--link)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.honey{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--soft)}
.head img{width:28px;height:28px;border-radius:6px;object-fit:contain}
.head h1{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iconbtn{min-width:44px;min-height:44px;margin:-6px -8px -6px 0;border:0;background:none;color:var(--fg);font-size:26px;line-height:1;border-radius:8px;cursor:pointer}
.panel{display:flex;flex-direction:column;height:100%;animation:fade .15s ease-out}
.body{flex:1;overflow:auto;padding:16px}
.foot{padding:8px 16px;text-align:center;font-size:12px;color:var(--muted);border-top:1px solid var(--soft)}
.foot a{color:var(--muted)}
label,.lbl{display:block;font-weight:600;margin:0 0 4px}
.req{font-weight:400;color:var(--muted);font-size:13px}
.hint{color:var(--muted);font-size:13px;margin:0 0 6px}
.field{margin:0 0 14px}
.in{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--input);color:var(--fg);font:inherit}
textarea.in{min-height:96px;resize:vertical}
.in[aria-invalid=true]{border-color:var(--err);border-width:2px}
.chk{display:flex;gap:10px;align-items:flex-start;min-height:44px;font-weight:400}
.chk input{width:22px;height:22px;margin:2px 0 0;flex:none}
.err{color:var(--err);font-size:13px;margin:4px 0 0}
.banner{border:1px solid var(--err);color:var(--err);border-radius:8px;padding:10px 12px;margin:0 0 14px}
button{font:inherit}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
.btn.secondary{background:transparent;color:var(--fg);border-color:var(--border)}
.btn[disabled]{opacity:.6;cursor:default}
.btn.block{width:100%}
.stack{display:grid;gap:10px}
.pagemode{max-width:520px;margin:0 auto;border-left:1px solid var(--soft);border-right:1px solid var(--soft)}
.wide{max-width:680px;margin:0 auto;padding:16px}
.linkbtn.inl{display:inline;min-height:0;padding:0;font-size:inherit}
.linkbtn{display:inline-block;min-height:44px;padding:10px 0;border:0;background:none;color:var(--link);text-decoration:underline;cursor:pointer}
:focus-visible{outline:2px solid var(--link);outline-offset:2px}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--tagbg);color:var(--tagfg);font-size:12px;font-weight:650}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--border);font-size:13px;font-weight:600}
.card{background:var(--surface);border:1px solid var(--soft);border-radius:12px;padding:14px;margin:0 0 14px}
.kind{background:var(--surface);border-left:4px solid var(--accent);padding:10px 12px;border-radius:0 8px 8px 0;margin:0 0 14px}
.muted{color:var(--muted);font-size:13px}
.answer{white-space:pre-wrap;margin:8px 0}
.msgs{display:grid;gap:12px;margin:0 0 18px}
.msg{border:1px solid var(--soft);border-radius:12px;padding:12px;background:var(--surface)}
.msg.mine{background:var(--bg);border-color:var(--border)}
.who{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);margin:0 0 6px}
.who b{color:var(--fg)}
.txt{white-space:pre-wrap;overflow-wrap:anywhere}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media (max-width:480px){body{font-size:16px}.in{font-size:16px}.iconbtn{order:-1;margin:-6px 0 -6px -8px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
}

export function htmlPage(opts: { nonce: string; title: string; theme: string; css: string; body: string; script: string }): string {
  const theme = ["auto", "light", "dark"].includes(opts.theme) ? opts.theme : "auto";
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<title>${escapeHtml(opts.title)}</title>
<style nonce="${opts.nonce}">${opts.css}</style>
</head>
<body>
${opts.body}
<script nonce="${opts.nonce}">${opts.script}</script>
</body>
</html>`;
}

export function notFoundPage(message = "This link is not valid."): { html: string; headers: Record<string, string> } {
  const nonce = newNonce();
  const html = htmlPage({
    nonce,
    title: "Not found",
    theme: "auto",
    css: themeCss({ title: "", brandColor: "#047857", logoUrl: null, theme: "auto" }),
    body: `<main class="body"><h1>Not found</h1><p>${escapeHtml(message)}</p></main>`,
    script: "",
  });
  return { html, headers: securityHeaders({ nonce, frameAncestors: [], turnstile: false }) };
}
