import { htmlPage, jsonForScript, newNonce, securityHeaders, themeCss } from "./page-shell";
import { turnstileSiteKey } from "./turnstile";
import type { PublicSpace } from "./public-store";
import { escapeHtml } from "./sanitize";

// The customer widget: one server-built page that runs inside an iframe on the
// owner's site (/widget/KEY) or on its own (/help/KEY). The script is plain ES5,
// written with string concatenation only (no backticks and no dollar-brace),
// because it lives inside a template literal.
//
// Flow: ask a question -> AI answer (only when covered by the owner's help notes)
// -> contact form -> confirmation. Customer text is only set with textContent.

export const WIDGET_CLIENT = String.raw`
(function(){
'use strict';
var cfg=JSON.parse(document.getElementById('cfg').textContent);
var API='/api/support/space/'+cfg.key;
var view=document.getElementById('view');
var live=document.getElementById('live');
var inFrame=window.parent!==window;
var state={question:'',blob:'',busy:false};
var tsReady=null,tsId=null,tsResolve=null,tsReject=null;

function h(tag,attrs,kids){
  var e=document.createElement(tag);
  if(attrs){for(var k in attrs){
    var v=attrs[k];
    if(v===null||v===undefined||v===false)continue;
    if(k==='class')e.className=v;
    else if(k==='text')e.textContent=v;
    else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else if(v===true)e.setAttribute(k,'');
    else e.setAttribute(k,String(v));
  }}
  (kids||[]).forEach(function(c){
    if(c===null||c===undefined||c===false)return;
    e.appendChild(typeof c==='string'?document.createTextNode(c):c);
  });
  return e;
}
function announce(msg){live.textContent='';setTimeout(function(){live.textContent=msg;},50);}
function render(nodes,focusSel){
  view.textContent='';
  nodes.forEach(function(n){view.appendChild(n);});
  view.scrollTop=0;
  if(focusSel){var f=view.querySelector(focusSel);if(f)f.focus();}
}
function closeWidget(){
  if(inFrame){window.parent.postMessage({ihq:'close'},'*');}
  else{start();}
}

function loadTurnstile(){
  if(tsReady)return tsReady;
  tsReady=new Promise(function(resolve,reject){
    if(window.turnstile){resolve();return;}
    var s=document.createElement('script');
    s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async=true;
    s.setAttribute('nonce',cfg.nonce);
    s.onload=function(){resolve();};
    s.onerror=function(){reject(new Error('turnstile'));};
    document.head.appendChild(s);
  });
  return tsReady;
}
function getToken(){
  if(!cfg.siteKey)return Promise.resolve('');
  return loadTurnstile().then(function(){
    return new Promise(function(resolve,reject){
      tsResolve=resolve;tsReject=reject;
      if(tsId===null){
        tsId=window.turnstile.render('#ts',{
          sitekey:cfg.siteKey,appearance:'interaction-only',execution:'execute',
          callback:function(t){if(tsResolve)tsResolve(t);},
          'error-callback':function(){if(tsReject)tsReject(new Error('turnstile'));},
          'timeout-callback':function(){if(tsReject)tsReject(new Error('turnstile'));}
        });
      }else{window.turnstile.reset(tsId);}
      window.turnstile.execute(tsId);
    });
  });
}
function post(path,body){
  return fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(d){return {status:r.status,data:d};});});
}

function gate(){
  return h('p',{class:'muted'},['We could not check that you are a person. Reload this page and try again.']);
}

/* ---- ask view ---- */
function start(){
  state.question='';state.blob='';
  if(!cfg.ai){form('',null);return;}
  var ta=h('textarea',{id:'q',class:'in',rows:'3',maxlength:'1000',placeholder:'For example: How do I change my settings?','aria-describedby':'q-hint'});
  var errBox=h('p',{class:'err',id:'q-err',role:'alert'});
  var btn=h('button',{type:'submit',class:'btn block'},['Get an answer']);
  var f=h('form',{novalidate:true,onsubmit:function(ev){
    ev.preventDefault();
    var q=ta.value.trim();
    errBox.textContent='';
    if(!q){errBox.textContent='Write your question first';ta.setAttribute('aria-invalid','true');ta.focus();return;}
    ta.removeAttribute('aria-invalid');
    state.question=q;
    ask(btn,errBox);
  }},[
    h('div',{class:'field'},[
      h('label',{for:'q'},['Your question']),
      h('p',{class:'hint',id:'q-hint'},['Write it as you would say it. We look for an answer in our help notes.']),
      ta,errBox
    ]),
    btn,
    h('div',{},[h('button',{type:'button',class:'linkbtn',onclick:function(){form(ta.value.trim(),null);}},['Or send a message to our team'])])
  ]);
  render([f],'#q');
}
function ask(btn,errBox){
  if(state.busy)return;
  state.busy=true;btn.disabled=true;btn.textContent='Looking in our help notes…';
  announce('Looking in our help notes');
  getToken().then(function(token){
    return post('/ask',{question:state.question,token:token});
  }).then(function(r){
    state.busy=false;
    if(r.status===200&&r.data.kind==='answer'){answer(r.data);return;}
    if(r.status===200&&r.data.kind==='person'){
      form(state.question,r.data.reason==='sensitive'?'sensitive':'unsure');return;
    }
    if(r.status===429){
      btn.disabled=false;btn.textContent='Get an answer';
      errBox.textContent='You have asked a lot of questions. Please try again later, or send us a message.';return;
    }
    btn.disabled=false;btn.textContent='Get an answer';
    errBox.textContent='Something went wrong. Please try again, or send a message to our team.';
  }).catch(function(){
    state.busy=false;btn.disabled=false;btn.textContent='Get an answer';
    errBox.textContent='We could not check that you are a person. Reload this page and try again.';
  });
}

/* ---- AI answer ---- */
function answer(d){
  state.blob=d.blob||'';
  announce('Answer found');
  render([
    h('div',{class:'card'},[
      h('span',{class:'tag'},['AI answer']),
      h('p',{class:'answer',id:'ans',tabindex:'-1',text:d.answer}),
      h('p',{class:'muted'},['Based on our help notes. Not what you needed? ',
        h('button',{type:'button',class:'linkbtn',onclick:function(){form(state.question,'unsure');}},['Contact us'])])
    ]),
    h('div',{class:'stack'},[
      h('button',{type:'button',class:'btn',onclick:thanks},['That solved it']),
      h('button',{type:'button',class:'btn secondary',onclick:function(){form(state.question,'unsure');}},['This did not help, contact us'])
    ])
  ],'#ans');
}
function thanks(){
  announce('Glad that helped');
  render([
    h('h2',{id:'t',tabindex:'-1'},['Glad that helped']),
    h('p',{},['If something else comes up, just ask again.']),
    h('button',{type:'button',class:'btn',onclick:closeWidget},[inFrame?'Close':'Ask another question'])
  ],'#t');
}

/* ---- contact form ---- */
function field(def,errs){
  var id='f-'+def.id;
  var err=h('p',{class:'err',id:id+'-err',role:'alert'});
  var req=def.required?h('span',{class:'req'},[' (required)']):null;
  var hint=def.helpText?h('p',{class:'hint',id:id+'-hint'},[def.helpText]):null;
  var desc=(def.helpText?id+'-hint ':'')+id+'-err';
  var input;
  if(def.type==='textarea'){
    input=h('textarea',{id:id,class:'in',rows:'4',name:def.id,maxlength:def.maxLength||5000,'aria-describedby':desc});
  }else if(def.type==='select'){
    input=h('select',{id:id,class:'in',name:def.id,'aria-describedby':desc},[h('option',{value:''},['Choose…'])].concat((def.options||[]).map(function(o){return h('option',{value:o,text:o});})));
  }else if(def.type==='checkbox'){
    input=h('input',{id:id,type:'checkbox',name:def.id,'aria-describedby':desc});
    return {el:h('div',{class:'field'},[h('label',{class:'chk',for:id},[input,h('span',{},[def.label,req])]),hint,err]),input:input,err:err,def:def};
  }else{
    input=h('input',{id:id,class:'in',name:def.id,type:def.type==='email'?'email':(def.type==='number'?'text':'text'),inputmode:def.type==='number'?'decimal':null,autocomplete:def.type==='email'?'email':(def.id==='name'?'name':'off'),maxlength:def.maxLength||200,'aria-describedby':desc});
  }
  return {el:h('div',{class:'field'},[h('label',{for:id},[def.label,req]),hint,input,err]),input:input,err:err,def:def};
}
function form(prefill,kind){
  var parts=[];
  var intro=null;
  if(kind==='sensitive'){intro=h('p',{class:'kind',id:'kind'},['That one needs a person. Order and account questions are handled by our team, and we will reply by email.']);}
  else if(kind==='unsure'){intro=h('p',{class:'kind',id:'kind'},['We could not find an answer in our help notes. Send us a message and we will reply by email.']);}
  var defs=[{id:'email',label:'Your email',type:'email',required:true,maxLength:254,helpText:'We reply here. Nobody else sees it.'}]
    .concat(cfg.form.fields)
    .concat([{id:'message',label:'Your message',type:'textarea',required:true,maxLength:5000}]);
  var rows=defs.map(function(d){return field(d);});
  var banner=h('div',{id:'banner'});
  var honey=h('div',{class:'honey','aria-hidden':'true'},[h('label',{for:'website'},['Website']),h('input',{id:'website',name:'website',tabindex:'-1',autocomplete:'off'})]);
  var btn=h('button',{type:'submit',class:'btn block'},['Send message']);
  rows.forEach(function(r){if(r.def.id==='message'&&prefill)r.input.value=prefill;});
  var f=h('form',{novalidate:true,onsubmit:function(ev){
    ev.preventDefault();
    if(state.busy)return;
    banner.textContent='';
    var payload={fields:{},website:honey.querySelector('input').value,aiBlob:state.blob||undefined};
    rows.forEach(function(r){
      var d=r.def;r.err.textContent='';r.input.removeAttribute('aria-invalid');
      var v=d.type==='checkbox'?r.input.checked:r.input.value;
      if(d.id==='email'||d.id==='message')payload[d.id]=v;else payload.fields[d.id]=v;
    });
    state.busy=true;btn.disabled=true;btn.textContent='Sending…';
    announce('Sending your message');
    getToken().then(function(token){
      payload.token=token;
      return post('/tickets',payload);
    }).then(function(r){
      state.busy=false;btn.disabled=false;btn.textContent='Send message';
      if(r.status===200&&r.data.ok){done(r.data,payload.email);return;}
      if(r.status===422&&r.data.errors){
        var first=null;
        rows.forEach(function(row){
          var m=r.data.errors[row.def.id];
          if(m){row.err.textContent=m;row.input.setAttribute('aria-invalid','true');if(!first)first=row.input;}
        });
        if(r.data.errors.form){banner.appendChild(h('p',{class:'banner',role:'alert',text:r.data.errors.form}));}
        announce('Please check the highlighted fields');
        if(first)first.focus();
        return;
      }
      if(r.status===429){banner.appendChild(h('p',{class:'banner',role:'alert'},['Too many messages from here. Please try again later.']));return;}
      banner.appendChild(h('p',{class:'banner',role:'alert'},['Something went wrong. Your message was not sent. Please try again.']));
    }).catch(function(){
      state.busy=false;btn.disabled=false;btn.textContent='Send message';
      banner.appendChild(h('p',{class:'banner',role:'alert'},['We could not check that you are a person. Reload this page and try again.']));
    });
  }},[].concat(rows.map(function(r){return r.el;})).concat([honey,banner,
    h('p',{class:'muted'},['We use your email and message only to answer you. We keep them for '+cfg.retention+' after we close the ticket.']),
    btn]));
  var nodes=[];
  if(intro)nodes.push(intro);
  if(cfg.ai&&!kind){nodes.push(h('p',{},[h('button',{type:'button',class:'linkbtn',onclick:start},['← Ask a question instead'])]));}
  nodes.push(f);
  render(nodes,kind==='sensitive'?'#f-email':(prefill?'#f-email':'#f-email'));
  if(kind)announce(kind==='sensitive'?'That question needs a person. Please fill in the form.':'Please fill in the form to contact our team.');
}

/* ---- confirmation ---- */
function done(d,email){
  announce('Message sent');
  var nodes=[
    h('h2',{id:'t',tabindex:'-1'},['Thanks, we got your message']),
    h('p',{},['Ticket #'+d.number+'. We will answer at ',h('b',{text:email}),'.']),
    h('p',{},['Check your inbox, and your spam folder, for a link to follow this ticket.'])
  ];
  if(cfg.replyTime)nodes.push(h('p',{class:'muted',text:cfg.replyTime}));
  nodes.push(h('button',{type:'button',class:'btn',onclick:closeWidget},['Done']));
  render(nodes,'#t');
}

/* ---- keyboard: Escape closes, Tab stays inside ---- */
document.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'&&inFrame){ev.preventDefault();window.parent.postMessage({ihq:'close'},'*');return;}
  if(ev.key!=='Tab')return;
  var els=Array.prototype.slice.call(document.querySelectorAll('a[href],button:not([disabled]),input:not([tabindex="-1"]):not([disabled]),select,textarea,[tabindex="0"]')).filter(function(e){return e.offsetParent!==null;});
  if(!els.length)return;
  var first=els[0],last=els[els.length-1];
  if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}
  else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}
});
window.addEventListener('message',function(ev){
  if(ev.source===window.parent&&ev.data&&ev.data.ihq==='focus'){
    var t=view.querySelector('textarea,input:not([tabindex="-1"]),button');if(t)t.focus();
  }
});
if(!inFrame){var c=document.getElementById('close');if(c)c.hidden=true;}
else{document.getElementById('close').addEventListener('click',closeWidget);}
start();
})();
`;

export function renderWidget(space: PublicSpace, opts: { aiAvailable: boolean; page: boolean }): { html: string; headers: Record<string, string> } {
  const nonce = newNonce();
  const siteKey = turnstileSiteKey();
  const cfg = {
    key: space.key,
    nonce,
    siteKey,
    ai: opts.aiAvailable,
    form: { fields: space.form.fields },
    replyTime: space.replyTimeNote || "",
    retention: retentionText(space.retentionDays),
  };
  const logo = space.logoUrl ? `<img src="${escapeHtml(space.logoUrl)}" alt="" width="28" height="28">` : "";
  const body = `<main class="panel${opts.page ? " pagemode" : ""}" aria-labelledby="title">
<header class="head">${logo}<h1 id="title">${escapeHtml(space.title)}</h1><button type="button" class="iconbtn" id="close" aria-label="Close">&times;</button></header>
<div id="live" class="sr" role="status" aria-live="polite"></div>
<div id="view" class="body"></div>
<div id="ts"></div>
<footer class="foot"><a href="https://ideahq.cloud" target="_blank" rel="noopener noreferrer">Powered by Idea HQ</a></footer>
</main>
<script type="application/json" id="cfg">${jsonForScript(cfg)}</script>`;
  const html = htmlPage({ nonce, title: space.title, theme: space.theme, css: themeCss(space), body, script: WIDGET_CLIENT });
  const frameAncestors = opts.page ? [] : ["'self'", ...space.allowedOrigins];
  return { html, headers: securityHeaders({ nonce, frameAncestors, turnstile: !!siteKey }) };
}

export function retentionText(days: number): string {
  if (days >= 700) return `${Math.round(days / 365)} years`;
  if (days >= 330) return "a year";
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${days} days`;
}
