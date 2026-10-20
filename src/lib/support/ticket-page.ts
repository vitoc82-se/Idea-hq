import { CUSTOMER_STATUS_LABEL } from "./constants";
import { htmlPage, jsonForScript, newNonce, securityHeaders, themeCss } from "./page-shell";
import type { PublicTicket } from "./public-store";
import { escapeHtml } from "./sanitize";

// The customer's private ticket page (/t/TOKEN): one plain-text conversation,
// one reply box. Layout is a single centred column; the status is a word, not a colour.

export const TICKET_CLIENT = String.raw`
(function(){
'use strict';
var cfg=JSON.parse(document.getElementById('cfg').textContent);
var API='/api/support/ticket/'+cfg.token;
var list=document.getElementById('msgs');
var live=document.getElementById('live');
var statusEl=document.getElementById('status');
function h(tag,attrs,kids){
  var e=document.createElement(tag);
  if(attrs){for(var k in attrs){var v=attrs[k];if(v===null||v===undefined||v===false)continue;
    if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);else e.setAttribute(k,String(v));}}
  (kids||[]).forEach(function(c){if(c===null||c===undefined||c===false)return;e.appendChild(typeof c==='string'?document.createTextNode(c):c);});
  return e;
}
function when(iso){try{return new Date(iso).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});}catch(e){return iso;}}
function drawMessages(messages){
  list.textContent='';
  messages.forEach(function(m){
    var who;
    if(m.author==='ai')who=[h('span',{class:'tag'},['AI answer'])];
    else if(m.author==='owner')who=[h('b',{text:cfg.title+' team'})];
    else who=[h('b',{},['You'])];
    who.push(h('span',{text:when(m.createdAt)}));
    list.appendChild(h('li',{class:'msg'+(m.author==='customer'?' mine':'')},[
      h('div',{class:'who'},who),
      h('div',{class:'txt',text:m.body})
    ]));
  });
}
function applyStatus(t){
  statusEl.textContent=cfg.labels[t.status]||t.status;
  var closed=t.status==='closed';
  document.getElementById('reply').hidden=closed;
  document.getElementById('closedNote').hidden=!closed;
}
function load(){
  return fetch(API,{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(t){
    if(!t)return;drawMessages(t.messages);applyStatus(t);
  });
}
drawMessages(JSON.parse(document.getElementById('initial').textContent).messages);
var form=document.getElementById('replyForm');
var box=document.getElementById('body');
var err=document.getElementById('err');
var btn=document.getElementById('send');
form.addEventListener('submit',function(ev){
  ev.preventDefault();
  err.textContent='';box.removeAttribute('aria-invalid');
  var text=box.value.trim();
  if(!text){err.textContent='Write a reply first';box.setAttribute('aria-invalid','true');box.focus();return;}
  btn.disabled=true;btn.textContent='Sending…';
  fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text})})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(d){return {status:r.status,data:d};});})
    .then(function(r){
      btn.disabled=false;btn.textContent='Send reply';
      if(r.status===200&&r.data.ok){
        box.value='';live.textContent='';setTimeout(function(){live.textContent='Reply sent';},50);
        return load();
      }
      if(r.status===429){err.textContent='Too many replies. Please try again later.';return;}
      if(r.status===409){err.textContent='This ticket is closed. Please send a new message instead.';load();return;}
      err.textContent=(r.data&&r.data.error)||'Your reply was not sent. Check your connection and try again.';
    }).catch(function(){btn.disabled=false;btn.textContent='Send reply';err.textContent='Your reply was not sent. Check your connection and try again.';});
});
})();
`;

export function renderTicketPage(t: PublicTicket, token: string): { html: string; headers: Record<string, string> } {
  const nonce = newNonce();
  const s = t.space;
  const cfg = { token, title: s.title, labels: CUSTOMER_STATUS_LABEL };
  const logo = s.logoUrl ? `<img src="${escapeHtml(s.logoUrl)}" alt="" width="28" height="28">` : "";
  const closed = t.status === "closed";
  const body = `<div class="head">${logo}<h1>${escapeHtml(s.title)}</h1></div>
<main class="wide">
<p class="muted">Ticket #${t.number}</p>
<h2 id="subject">${escapeHtml(t.subject)}</h2>
<p>Status: <span class="chip" id="status">${escapeHtml(CUSTOMER_STATUS_LABEL[t.status])}</span></p>
<div id="live" class="sr" role="status" aria-live="polite"></div>
<ol class="msgs" id="msgs"></ol>
<section id="reply" ${closed ? "hidden" : ""} aria-labelledby="replyTitle">
<h2 id="replyTitle">Reply</h2>
<form id="replyForm" novalidate>
<div class="field"><label for="body">Your reply</label>
<textarea id="body" class="in" rows="5" maxlength="5000" aria-describedby="err"></textarea>
<p class="err" id="err" role="alert"></p></div>
<button type="submit" class="btn" id="send">Send reply</button>
</form>
</section>
<p id="closedNote" ${closed ? "" : "hidden"}>This ticket is closed. If you still need help, <a href="/help/${s.key}">send us a new message</a>.</p>
<p class="muted">This page is private to you. Keep the link to yourself. To have this conversation deleted, ask in a reply.</p>
</main>
<footer class="foot"><a href="https://ideahq.cloud" target="_blank" rel="noopener noreferrer">Powered by Idea HQ</a></footer>
<script type="application/json" id="cfg">${jsonForScript(cfg)}</script>
<script type="application/json" id="initial">${jsonForScript({ messages: t.messages })}</script>`;
  const script = TICKET_CLIENT;
  const html = htmlPage({ nonce, title: `Ticket #${t.number} · ${s.title}`, theme: s.theme, css: themeCss(s) + "\n.msgs{list-style:none;padding:0}", body, script });
  return { html, headers: securityHeaders({ nonce, frameAncestors: [], turnstile: false }) };
}
