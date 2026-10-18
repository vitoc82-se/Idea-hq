"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowDown, Trash2, Loader2, Copy, Check, Plus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_STARTERS, type FormField } from "@/lib/support/form-schema";
import type { Note } from "@/lib/support/notes";

type Settings = {
  key: string; enabled: boolean; title: string; brandColor: string; logoUrl: string | null; theme: string; allowedOrigins: string[];
  formSchema: { fields: FormField[] }; aiEnabled: boolean; aiDailyCap: number; retentionDays: number; notifyEmail: string | null;
  replyTimeNote: string | null; notes: Note[]; baseUrl: string; aiSwitchOn: boolean;
};

const TYPES: { id: FormField["type"]; label: string }[] = [
  { id: "text", label: "Short text" }, { id: "textarea", label: "Long text" }, { id: "email", label: "Email" },
  { id: "number", label: "Number" }, { id: "select", label: "Choice" }, { id: "checkbox", label: "Checkbox" },
];

function uniqueId(base: string, fields: FormField[]): string {
  let id = base;
  for (let n = 2; fields.some((f) => f.id === id); n++) id = `${base}_${n}`;
  return id;
}
export function SupportSettings({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const [exists, setExists] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"ai" | "code" | "link">("ai");
  const [copied, setCopied] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [siteResult, setSiteResult] = useState<string>("");
  const [privEmail, setPrivEmail] = useState("");
  const [privMsg, setPrivMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/support`, { cache: "no-store" });
    if (!res.ok) return setLoadError("Could not load the support settings.");
    const d = await res.json();
    if (d.space) {
      setS(d.space);
      setExists(true);
    } else {
      setExists(false);
    }
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const upd = (patch: Partial<Settings>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    setDirty(true);
    setMsg(null);
  };

  const enable = async () => {
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/support`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, title: projectName.slice(0, 60) }) });
    setSaving(false);
    if (!res.ok) return setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error || "Could not turn on support." });
    setS((await res.json()).space);
    setExists(true);
  };

  const save = async (override?: Partial<Settings>) => {
    if (!s) return;
    const cur = { ...s, ...override };
    setSaving(true);
    const res = await fetch(`/api/projects/${projectId}/support`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: cur.enabled, title: cur.title, brandColor: cur.brandColor, logoUrl: cur.logoUrl || null, theme: cur.theme,
        allowedOrigins: cur.allowedOrigins, formSchema: cur.formSchema, aiEnabled: cur.aiEnabled, aiDailyCap: cur.aiDailyCap,
        retentionDays: cur.retentionDays, notifyEmail: cur.notifyEmail || null, replyTimeNote: cur.replyTimeNote || null, notes: cur.notes,
      }),
    });
    setSaving(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Could not save." });
    setS(d.space);
    setDirty(false);
    setMsg({ ok: true, text: "Saved." });
  };

  const draftNotes = async () => {
    if (dirty && !window.confirm("Save your other changes first? Drafting reloads the help notes.")) return;
    if (dirty) await save();
    setDrafting(true);
    setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/support/notes-draft`, { method: "POST" });
    setDrafting(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Could not draft notes." });
    setS((cur) => (cur ? { ...cur, notes: d.notes } : cur));
    setMsg({ ok: true, text: `${d.added} draft notes added. Read each one, fix anything wrong, then approve it.` });
  };

  const checkSite = async () => {
    setSiteResult("Checking…");
    const res = await fetch(`/api/projects/${projectId}/support/check-site`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: siteUrl }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setSiteResult(d.error || "Could not check.");
    if (d.status === "invalid") return setSiteResult("That does not look like a website address. Use something like https://yourshop.com");
    if (d.status === "blocked") return setSiteResult("We can only check public websites.");
    if (d.status === "unreachable") return setSiteResult("We could not open that page. Check the address and that the site is online.");
    const parts: string[] = [];
    parts.push(d.found ? "The Help button code is on that page." : "We did not find the Help button code on that page. Add the code from the tabs above, then check again.");
    parts.push(d.allowed ? `${d.origin} is on your allowed sites, so the widget can open there.` : `${d.origin} is NOT on your allowed sites, so the widget would be blocked there. Add it under "Allowed sites" and save.`);
    setSiteResult(parts.join(" "));
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setMsg({ ok: false, text: "Could not copy. Select the text and copy it by hand." });
    }
  };

  const privacy = async (action: "delete" | "export") => {
    setPrivMsg("");
    if (!privEmail.trim()) return setPrivMsg("Enter the customer's email address.");
    if (action === "export") {
      window.location.href = `/api/tickets/export?project=${projectId}&email=${encodeURIComponent(privEmail.trim())}`;
      return;
    }
    if (!window.confirm(`Delete every ticket from ${privEmail.trim()} in this project? This cannot be undone.`)) return;
    const res = await fetch("/api/tickets/by-email", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, email: privEmail.trim() }) });
    const d = await res.json().catch(() => ({}));
    setPrivMsg(res.ok ? `Deleted ${d.deleted} ticket${d.deleted === 1 ? "" : "s"}.` : d.error || "Could not delete.");
  };

  if (loadError) return <p role="alert" className="text-red-700">{loadError}</p>;
  if (!exists) {
    return (
      <div className="max-w-xl space-y-3">
        <Link href="/projects" className="text-sm text-emerald-700 hover:underline">← Back to projects</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Support for {projectName}</h1>
        <p className="text-gray-700 dark:text-gray-300">Add a Help button to your site. Customers ask a question, get an answer from your own help notes, or send you a message. You answer from one inbox, and they get your reply by email.</p>
        <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={enable} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Turn on support</Button>
        {msg && <p role="alert" className="text-sm text-red-700">{msg.text}</p>}
      </div>
    );
  }
  if (!s) return <div aria-busy="true" className="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />;

  const snippet = `<script src="${s.baseUrl}/embed/${s.key}.js" defer></script>`;
  const link = `${s.baseUrl}/help/${s.key}`;
  const aiPrompt = `Add a customer support Help button to my website. Paste this line just before the closing </body> tag on every page where the button should appear (or in the shared layout/template):\n\n${snippet}\n\nDo not change anything else. My support key is ${s.key}.`;
  const confirmedCount = s.notes.filter((n) => n.status === "confirmed").length;
  const fields = s.formSchema.fields;
  const setFields = (f: FormField[]) => upd({ formSchema: { fields: f } });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };
  const editField = (i: number, patch: Partial<FormField>) => setFields(fields.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  return (
    <div className="max-w-4xl space-y-6 pb-24">
      <div>
        <Link href="/projects" className="text-sm text-emerald-700 hover:underline">← Back to projects</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Support for {projectName}</h1>
        <label className="mt-2 flex min-h-[44px] items-center gap-3 text-sm font-medium text-gray-900 dark:text-white">
          <input type="checkbox" className="h-5 w-5" checked={s.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
          Support is {s.enabled ? "on" : "off"}{!s.enabled && <span className="font-normal text-gray-600 dark:text-gray-400"> (the Help button shows nothing while it is off)</span>}
        </label>
      </div>

      {/* Put it on your site */}
      <Card id="site"><CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Put it on your site</h2>
        <div>
          <Label htmlFor="origins">Allowed sites</Label>
          <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">The Help button only opens on these websites, one per line. Example: https://yourshop.com</p>
          <Textarea id="origins" rows={3} value={s.allowedOrigins.join("\n")} onChange={(e) => upd({ allowedOrigins: e.target.value.split("\n") })} placeholder="https://yourshop.com" />
        </div>
        <div role="tablist" aria-label="How to add it" className="flex flex-wrap gap-2">
          {([["ai", "Ask your AI to add it"], ["code", "Paste a code snippet"], ["link", "Just a link"]] as const).map(([id, label]) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}
              className={`min-h-[44px] rounded-lg border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${tab === id ? "border-emerald-700 bg-emerald-700 text-white" : "border-gray-400 bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-100"}`}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-2">
          {tab === "ai" && (<>
            <p className="text-sm text-gray-700 dark:text-gray-300">Paste this to your AI coding assistant (Claude, ChatGPT, Cursor...).</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100">{aiPrompt}</pre>
            <Button variant="outline" onClick={() => copy("ai", aiPrompt)}>{copied === "ai" ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{copied === "ai" ? "Copied" : "Copy"}</Button>
          </>)}
          {tab === "code" && (<>
            <p className="text-sm text-gray-700 dark:text-gray-300">Paste this line into your site, just before the closing &lt;/body&gt; tag.</p>
            <pre className="overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100">{snippet}</pre>
            <p className="text-xs text-gray-600 dark:text-gray-400">Optional: add data-position=&quot;left&quot; to put the button on the left, or data-label=&quot;Support&quot; to change its text.</p>
            <Button variant="outline" onClick={() => copy("code", snippet)}>{copied === "code" ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{copied === "code" ? "Copied" : "Copy"}</Button>
          </>)}
          {tab === "link" && (<>
            <p className="text-sm text-gray-700 dark:text-gray-300">No website changes needed. Put this link in your app, emails or social profiles.</p>
            <pre className="overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100">{link}</pre>
            <Button variant="outline" onClick={() => copy("link", link)}>{copied === "link" ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}{copied === "link" ? "Copied" : "Copy"}</Button>
          </>)}
        </div>
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <Label htmlFor="check">Check my site</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Input id="check" className="max-w-sm" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yourshop.com" />
            <Button variant="outline" onClick={checkSite} disabled={!siteUrl.trim()}>Check</Button>
          </div>
          <p role="status" className="mt-2 text-sm text-gray-800 dark:text-gray-200">{siteResult}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">Save your allowed sites first, then check.</p>
        </div>
      </CardContent></Card>

      {/* Form */}
      <Card id="form"><CardContent className="grid gap-6 p-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">What the form asks</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Email and Message are always asked. Add what else you need to help people.</p>
          <ul className="space-y-3">
            {fields.map((f, i) => (
              <li key={f.id} className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-600">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[140px] flex-1">
                    <Label htmlFor={`fl-${i}`}>Question</Label>
                    <Input id={`fl-${i}`} value={f.label} maxLength={60} onChange={(e) => editField(i, { label: e.target.value })} />
                  </div>
                  <div className="w-36">
                    <Label htmlFor={`ft-${i}`}>Type</Label>
                    <Select id={`ft-${i}`} value={f.type} onChange={(e) => editField(i, { type: e.target.value as FormField["type"], options: e.target.value === "select" ? f.options || ["Option 1", "Option 2"] : undefined })}>
                      {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </Select>
                  </div>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-white"><input type="checkbox" className="h-5 w-5" checked={f.required} onChange={(e) => editField(i, { required: e.target.checked })} /> Required</label>
                  <div className="flex">
                    <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${f.label} up`}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label={`Move ${f.label} down`}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setFields(fields.filter((_, k) => k !== i))} aria-label={`Delete ${f.label}`} className="text-red-700"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {f.type === "select" && (
                  <div>
                    <Label htmlFor={`fo-${i}`}>Choices, one per line</Label>
                    <Textarea id={`fo-${i}`} rows={3} value={(f.options || []).join("\n")} onChange={(e) => editField(i, { options: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
                  </div>
                )}
                <div>
                  <Label htmlFor={`fh-${i}`}>Hint under the question (optional)</Label>
                  <Input id={`fh-${i}`} value={f.helpText || ""} maxLength={120} onChange={(e) => editField(i, { helpText: e.target.value || undefined })} />
                </div>
              </li>
            ))}
          </ul>
          {fields.length < 12 && (
            <div>
              <p className="mb-1 text-sm font-medium text-gray-900 dark:text-white">Add a field</p>
              <div className="flex flex-wrap gap-2">
                {FIELD_STARTERS.map((st) => (
                  <Button key={st.key} variant="outline" onClick={() => {
                    const id = uniqueId(st.field.id, fields);
                    setFields([...fields, { ...st.field, id }]);
                  }}><Plus className="mr-1 h-4 w-4" />{st.label}</Button>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside aria-label="Preview of the form" className="rounded-xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-900/40">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">What customers see</p>
          <div className="space-y-3 text-sm text-gray-900 dark:text-gray-100">
            <PreviewField label="Your email" required type="email" />
            {fields.map((f) => <PreviewField key={f.id} label={f.label || "Untitled"} required={f.required} type={f.type} hint={f.helpText} options={f.options} />)}
            <PreviewField label="Your message" required type="textarea" />
          </div>
        </aside>
      </CardContent></Card>

      {/* Help notes */}
      <Card id="notes"><CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Help notes for the AI</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">The AI may answer simple how-to questions, using only the notes you approve here. Questions about orders, payments or accounts always go to you. Nothing you have not approved is ever used.</p>
        <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-gray-900 dark:text-white">
          <input type="checkbox" className="h-5 w-5" checked={s.aiEnabled} onChange={(e) => upd({ aiEnabled: e.target.checked })} /> Let the AI answer simple questions from my approved notes
        </label>
        {s.aiEnabled && !s.aiSwitchOn && <p className="rounded-lg border border-amber-500 p-3 text-sm text-amber-900 dark:text-amber-200">AI answers are switched off for the whole site right now, so customers will go straight to your form.</p>}
        {s.aiEnabled && confirmedCount === 0 && <p className="text-sm text-gray-700 dark:text-gray-300">Approve at least one note below, otherwise customers go straight to your form.</p>}
        <div className="max-w-xs">
          <Label htmlFor="cap">Most AI answers per day</Label>
          <Input id="cap" type="number" min={0} max={500} value={s.aiDailyCap} onChange={(e) => upd({ aiDailyCap: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })} />
        </div>
        <ul className="space-y-3">
          {s.notes.map((n, i) => (
            <li key={n.id} className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-600">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`nt-${i}`} className="sr-only">Title</Label>
                <Input id={`nt-${i}`} className="min-w-[180px] flex-1" value={n.title} maxLength={100} onChange={(e) => upd({ notes: s.notes.map((x, k) => (k === i ? { ...x, title: e.target.value, status: "needs_review" } : x)) })} />
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${n.status === "confirmed" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100" : "bg-amber-50 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"}`}>{n.status === "confirmed" ? "Approved for customers" : "Needs your review"}</span>
              </div>
              <Label htmlFor={`nx-${i}`} className="sr-only">Text</Label>
              <Textarea id={`nx-${i}`} rows={3} maxLength={1500} value={n.text} onChange={(e) => upd({ notes: s.notes.map((x, k) => (k === i ? { ...x, text: e.target.value, status: "needs_review" } : x)) })} />
              <div className="flex gap-2">
                {n.status !== "confirmed" && <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => upd({ notes: s.notes.map((x, k) => (k === i ? { ...x, status: "confirmed" } : x)) })} disabled={!n.title.trim() || !n.text.trim()}>Approve</Button>}
                <Button variant="ghost" className="text-red-700" onClick={() => upd({ notes: s.notes.filter((_, k) => k !== i) })}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => upd({ notes: [...s.notes, { id: "new" + Date.now().toString(36), title: "", text: "", status: "needs_review" }] })} disabled={s.notes.length >= 40}><Plus className="mr-1 h-4 w-4" />Add a note</Button>
          <Button variant="outline" onClick={draftNotes} disabled={drafting}>{drafting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Draft notes from my project knowledge</Button>
        </div>
      </CardContent></Card>

      {/* Look and feel */}
      <Card><CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Look and feel</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="title">Name shown at the top</Label><Input id="title" value={s.title} maxLength={60} onChange={(e) => upd({ title: e.target.value })} /></div>
          <div><Label htmlFor="logo">Logo address (optional, https)</Label><Input id="logo" value={s.logoUrl || ""} onChange={(e) => upd({ logoUrl: e.target.value })} placeholder="https://yourshop.com/logo.png" /></div>
          <div>
            <Label htmlFor="color">Accent colour</Label>
            <div className="flex items-center gap-2">
              <input aria-label="Pick a colour" type="color" className="h-11 w-14 rounded border border-gray-400" value={/^#[0-9a-f]{6}$/i.test(s.brandColor) ? s.brandColor : "#047857"} onChange={(e) => upd({ brandColor: e.target.value })} />
              <Input id="color" value={s.brandColor} onChange={(e) => upd({ brandColor: e.target.value })} className="max-w-[140px]" />
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Very light colours are darkened automatically so white button text stays readable.</p>
          </div>
          <div><Label htmlFor="theme">Light or dark</Label>
            <Select id="theme" value={s.theme} onChange={(e) => upd({ theme: e.target.value })}>
              <option value="auto">Follow the visitor&apos;s setting</option><option value="light">Always light</option><option value="dark">Always dark</option>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label htmlFor="reply">When do you usually reply? (optional)</Label><Input id="reply" value={s.replyTimeNote || ""} maxLength={160} onChange={(e) => upd({ replyTimeNote: e.target.value })} placeholder="We usually reply within one working day." /></div>
          <div className="sm:col-span-2"><Label htmlFor="notify">Email me about new tickets at</Label><Input id="notify" type="email" value={s.notifyEmail || ""} onChange={(e) => upd({ notifyEmail: e.target.value })} placeholder="Leave empty to use your account email" /></div>
        </div>
      </CardContent></Card>

      {/* Privacy */}
      <Card><CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Privacy</h2>
        <div className="max-w-xs">
          <Label htmlFor="ret">Delete closed tickets after (days)</Label>
          <Input id="ret" type="number" min={7} max={3650} value={s.retentionDays} onChange={(e) => upd({ retentionDays: Math.max(7, Math.min(3650, Number(e.target.value) || 365)) })} />
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Counted from the day a ticket is resolved or closed. Customers are told this on the form.</p>
        </div>
        <div className="max-w-md">
          <Label htmlFor="pe">Handle a privacy request for one customer</Label>
          <Input id="pe" type="email" value={privEmail} onChange={(e) => setPrivEmail(e.target.value)} placeholder="customer@example.com" />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => privacy("export")}>Download their tickets</Button>
            <Button variant="outline" className="text-red-700" onClick={() => privacy("delete")}>Delete their tickets</Button>
          </div>
          <p role="status" className="mt-1 text-sm text-gray-800 dark:text-gray-200">{privMsg}</p>
        </div>
      </CardContent></Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-300 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 lg:pl-72">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => save()} disabled={saving || !dirty}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button>
          <p role="status" className={`text-sm ${msg?.ok === false ? "text-red-700 dark:text-red-400" : "text-gray-800 dark:text-gray-200"}`}>{msg?.text || (dirty ? "You have unsaved changes." : "")}</p>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ label, required, type, hint, options }: { label: string; required?: boolean; type: string; hint?: string; options?: string[] }) {
  return (
    <div>
      <p className="font-semibold">{label}{required && <span className="ml-1 text-xs font-normal text-gray-600 dark:text-gray-400">(required)</span>}</p>
      {hint && <p className="text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
      {type === "checkbox" ? <div className="mt-1 h-5 w-5 rounded border border-gray-500" /> : (
        <div className={`mt-1 rounded-md border border-gray-500 bg-white px-2 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400 ${type === "textarea" ? "h-16" : ""}`}>{type === "select" ? (options?.[0] ? `${options[0]} ▾` : "Choose ▾") : ""}</div>
      )}
    </div>
  );
}
