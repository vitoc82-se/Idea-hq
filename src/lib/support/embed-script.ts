import { accentForWhiteText } from "./contrast";

// The tiny script owners paste on their site (served at /embed/KEY.js). It adds
// a labelled "Help" button and opens the hosted widget in an iframe. The iframe
// is only allowed on sites in the owner's allow-list (frame-ancestors on the
// widget page). Written as plain ES5 inside a template literal: no backticks and
// no dollar-brace in the script body.

const EMBED_BODY = String.raw`
if(window.__ihqSupport)return;
var s=document.currentScript;
var pos=s&&s.getAttribute('data-position')==='left'?'left':'right';
var label=(s&&s.getAttribute('data-label'))||'Help';
label=String(label).slice(0,20);
var launcher,panel,frame,open=false,loaded=false,prevOverflow='';
function mobile(){return window.innerWidth<480;}
function place(){
  var m=mobile();
  var ps=panel.style;
  ps.position='fixed';ps.zIndex='2147483000';ps.background='#fff';ps.overflow='hidden';
  if(m){ps.top='0';ps.left='0';ps.right='0';ps.bottom='0';ps.width='100%';ps.height='100%';ps.borderRadius='0';ps.boxShadow='none';}
  else{ps.top='auto';ps.bottom='80px';ps.width='380px';ps.height='min(560px, calc(100vh - 100px))';ps.borderRadius='12px';ps.boxShadow='0 10px 40px rgba(0,0,0,.25)';
    ps.left=pos==='left'?'20px':'auto';ps.right=pos==='right'?'20px':'auto';}
  panel.setAttribute('aria-modal',m?'true':'false');
}
function openPanel(){
  if(open)return;open=true;
  if(!loaded){frame.src=ORIGIN+'/widget/'+KEY+'?embed=1';loaded=true;}
  panel.style.display='block';place();
  launcher.setAttribute('aria-expanded','true');
  if(mobile()){prevOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';launcher.style.display='none';}
  setTimeout(function(){try{frame.focus();frame.contentWindow.postMessage({ihq:'focus'},ORIGIN);}catch(e){}},150);
}
function closePanel(){
  if(!open)return;open=false;
  panel.style.display='none';
  launcher.setAttribute('aria-expanded','false');
  launcher.style.display='';
  document.documentElement.style.overflow=prevOverflow;
  launcher.focus();
}
function build(){
  launcher=document.createElement('button');
  launcher.type='button';
  launcher.textContent=label;
  launcher.setAttribute('aria-label',label+' and support');
  launcher.setAttribute('aria-haspopup','dialog');
  launcher.setAttribute('aria-expanded','false');
  var ls=launcher.style;
  ls.position='fixed';ls.bottom='20px';ls.zIndex='2147483000';ls.minHeight='48px';ls.minWidth='48px';ls.padding='0 20px';
  ls.border='0';ls.borderRadius='24px';ls.background=ACCENT;ls.color='#fff';ls.font='600 16px/1 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
  ls.cursor='pointer';ls.boxShadow='0 4px 14px rgba(0,0,0,.25)';
  if(pos==='left')ls.left='20px';else ls.right='20px';
  launcher.addEventListener('click',function(){open?closePanel():openPanel();});
  panel=document.createElement('div');
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-label','Help and support');
  panel.style.display='none';
  frame=document.createElement('iframe');
  frame.title='Help and support';
  frame.setAttribute('referrerpolicy','no-referrer');
  var fs=frame.style;fs.width='100%';fs.height='100%';fs.border='0';
  panel.appendChild(frame);
  document.body.appendChild(panel);
  document.body.appendChild(launcher);
  window.addEventListener('resize',function(){if(open)place();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&open)closePanel();});
  window.addEventListener('message',function(e){
    if(e.origin===ORIGIN&&e.data&&e.data.ihq==='close')closePanel();
  });
  window.__ihqSupport={open:openPanel,close:closePanel};
}
if(document.body)build();else document.addEventListener('DOMContentLoaded',build);
`;

export function embedScript(key: string, origin: string, brandColor: string): string {
  const head = `(function(){\n'use strict';\nvar KEY=${JSON.stringify(key)};var ORIGIN=${JSON.stringify(origin)};var ACCENT=${JSON.stringify(accentForWhiteText(brandColor))};\n`;
  return head + EMBED_BODY + "})();\n";
}

export const EMBED_NOT_AVAILABLE = "/* Idea HQ support is not available for this key. */\n";
