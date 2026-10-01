// The change card: a small self-contained page hosts that render tool UIs can
// show for write_changes and diff results. Hosts without that support ignore
// it; the normal content blocks stay the source of truth. No network, no
// external fonts, text inserted with textContent only.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DIFF_CARD_URI = 'ui://volumes/diff-card/v1';
const MIME = 'text/html;profile=mcp-app';

const STYLE = `
:root{--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#e5e5ea;--hover:#f2f2f7;--add:#e7f6ec;--addfg:#1a7f37;--del:#fdecec;--delfg:#c62828;--accent:#2f5bea}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--mute:#a1a1a6;--line:#38383a;--hover:#2c2c2e;--add:#12301d;--addfg:#56d17a;--del:#3a1717;--delfg:#ff7b72;--accent:#7a9cff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.bar{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:10px}
.bar:hover{background:var(--hover)}.bar:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.glyphs{display:flex;gap:3px}.g{width:12px;height:16px;border:1.5px solid var(--mute);border-radius:2px}
.g.img{border-radius:3px;background:linear-gradient(135deg,transparent 55%,var(--mute) 55%)}.g.dir{width:16px;height:12px;margin-top:2px;border-radius:2px 2px 3px 3px}
.label{font-weight:600}.where{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.chev{width:8px;height:8px;border-right:1.5px solid var(--mute);border-bottom:1.5px solid var(--mute);transform:rotate(45deg);transition:transform .15s}
.open .chev{transform:rotate(-135deg)}@media (prefers-reduced-motion:reduce){.chev{transition:none}}
.list{display:none;padding:0 12px 10px}.open .list{display:block}
.row{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-top:1px solid var(--line)}
.st{width:14px;font:600 12px ui-monospace,Menlo,monospace;text-align:center}.st.a{color:var(--addfg)}.st.r{color:var(--delfg)}
.path{font:12px ui-monospace,Menlo,monospace;word-break:break-all}
pre{margin:4px 0 8px 22px;padding:6px 0;border:1px solid var(--line);border-radius:8px;overflow:auto;font:12px/1.4 ui-monospace,Menlo,monospace;max-height:260px}
pre span{display:block;padding:0 8px;white-space:pre}pre .add{background:var(--add)}pre .del{background:var(--del)}pre .hunk{color:var(--mute)}
.foot{display:flex;gap:12px;align-items:center;margin-top:6px}
.btn{border:1px solid var(--line);background:none;color:inherit;font:inherit;border-radius:999px;padding:4px 12px;cursor:pointer}
.btn:hover{background:var(--hover)}.link{color:var(--accent);background:none;border:0;font:inherit;cursor:pointer;padding:0}
`;

const SCRIPT = `
(function(){
var root=document.getElementById('card');var data=null;var shown=5;var nextId=1;var pending={};
function send(msg){window.parent.postMessage(msg,'*');}
function request(method,params){var id=nextId++;send({jsonrpc:'2.0',id:id,method:method,params:params});return new Promise(function(res){pending[id]=res;});}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function kindOf(c){var r=c.result||c.op;if(r==='created'||r==='added'||r==='folder')return['+','a'];if(r==='deleted'||r==='removed')return['\\u2212','r'];if(r==='moved'||r==='copied')return['R',''];if(r==='proposed'){return c.op==='delete'?['\\u2212','r']:c.op==='move'||c.op==='copy'?['R','']:['+','a'];}return['M',''];}
function glyph(c){var p=c.path||'';if(c.type==='dir'||c.result==='folder'||c.op==='mkdir')return'dir';return /\\.(png|jpe?g|gif|webp|svg|heic|avif)$/i.test(p)?'img':'doc';}
function common(paths){if(!paths.length)return'/';var parts=paths[0].split('/').slice(0,-1);paths.forEach(function(p){var s=p.split('/');var i=0;while(i<parts.length&&parts[i]===s[i])i++;parts=parts.slice(0,i);});var d=parts.join('/');return d||'/';}
function openUrl(){if(!data)return null;if(data.proposal_url)return data.proposal_url;var c=(data.changes||[]).find(function(x){return x.url;});return c?c.url:(data.drive_compare_url||null);}
function render(){root.textContent='';if(!data||!Array.isArray(data.changes)){root.appendChild(el('div','bar','No changes to show'));return;}
var ch=data.changes;var n=ch.length;var proposed=data.outcome==='proposed';
var bar=el('button','bar');bar.setAttribute('aria-expanded',root.classList.contains('open')?'true':'false');
var gl=el('span','glyphs');ch.slice(0,3).forEach(function(c){gl.appendChild(el('span','g '+glyph(c)));});bar.appendChild(gl);
bar.appendChild(el('span','label',proposed?('Proposed '+n+(n===1?' change':' changes')):(n+(n===1?' file changed':' files changed'))));
bar.appendChild(el('span','where',common(ch.map(function(c){return c.path||'/';}))));bar.appendChild(el('span','chev'));
bar.onclick=function(){root.classList.toggle('open');render();};root.appendChild(bar);
var list=el('div','list');ch.slice(0,shown).forEach(function(c){var k=kindOf(c);var row=el('div','row');row.appendChild(el('span','st '+k[1],k[0]));
row.appendChild(el('span','path',c.from_path?(c.from_path+' \\u2192 '+c.path):c.path));list.appendChild(row);
if(typeof c.diff==='string'&&c.diff){var pre=el('pre');c.diff.split('\\n').forEach(function(line){var cls=/^\\+(?!\\+\\+)/.test(line)?'add':/^-(?!--)/.test(line)?'del':/^@@/.test(line)?'hunk':'';pre.appendChild(el('span',cls,line||' '));});list.appendChild(pre);}});
var foot=el('div','foot');if(n>shown){var more=el('button','btn','Show '+Math.min(5,n-shown)+' more');more.onclick=function(){shown+=5;render();};foot.appendChild(more);}
var u=openUrl();if(u){var a=el('button','link','Open in KDRIVE');a.onclick=function(){request('ui/open-link',{url:u});};foot.appendChild(a);}
list.appendChild(foot);root.appendChild(list);}
window.addEventListener('message',function(ev){if(ev.source!==window.parent)return;var m=ev.data;if(!m||m.jsonrpc!=='2.0')return;
if(m.id!=null&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];return;}
if(m.method==='ui/notifications/tool-result'){var p=m.params||{};data=p.structuredContent||(p.result&&p.result.structuredContent)||null;shown=5;render();}});
render();
request('ui/initialize',{appInfo:{name:'KDRIVE change card',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(function(){send({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});});
})();
`;

/** One self-contained document: inline CSS and script, no network. */
export const DIFF_CARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KDRIVE change card</title><style>${STYLE}</style></head><body><div id="card" role="region" aria-label="Changes"></div><script>${SCRIPT}</script></body></html>`;

/** Registers the card resource on a server. */
export function registerDiffCard(server: McpServer): void {
  server.registerResource(
    'diff-card',
    DIFF_CARD_URI,
    { title: 'KDRIVE change card', mimeType: MIME, description: 'Shows the files a KDRIVE change touched.' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: MIME,
          text: DIFF_CARD_HTML,
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
        },
      ],
    }),
  );
}
