// Universal client-side downloads for VetroAI responses and generated images.
// Supports text/markdown/json/html/csv plus browser-generated DOC, XLS and PDF,
// and PNG/JPG conversion for generated images. Uses Web Share when available.

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = (s='') => String(s).replace(/\r/g,'').trim();
const baseName = () => `vetroai-${new Date().toISOString().replace(/[:.]/g,'-')}`;

async function exportText(text, format) {
  const value = clean(text);
  const name = baseName();
  if (format === 'txt') return saveBlob(new Blob([value], {type:'text/plain;charset=utf-8'}), `${name}.txt`);
  if (format === 'md') return saveBlob(new Blob([value], {type:'text/markdown;charset=utf-8'}), `${name}.md`);
  if (format === 'json') return saveBlob(new Blob([JSON.stringify({content:value}, null, 2)], {type:'application/json'}), `${name}.json`);
  if (format === 'html') return saveBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>VetroAI</title><article style="max-width:850px;margin:40px auto;font:16px system-ui;white-space:pre-wrap">${esc(value)}</article>`], {type:'text/html;charset=utf-8'}), `${name}.html`);
  if (format === 'csv') {
    const rows=value.split('\n').filter(Boolean).map(line=>[line]);
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    return saveBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`${name}.csv`);
  }
  if (format === 'doc') {
    const html=`<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial;white-space:pre-wrap">${esc(value)}</div></body></html>`;
    return saveBlob(new Blob([html],{type:'application/msword'}),`${name}.doc`);
  }
  if (format === 'xls') {
    const html=`<table><tr><td style="white-space:pre-wrap">${esc(value)}</td></tr></table>`;
    return saveBlob(new Blob([html],{type:'application/vnd.ms-excel'}),`${name}.xls`);
  }
  if (format === 'pdf') {
    const w=window.open('','_blank');
    if(!w) throw new Error('Allow pop-ups to export PDF.');
    w.document.write(`<!doctype html><title>VetroAI export</title><style>body{font:15px Arial;max-width:850px;margin:40px auto;white-space:pre-wrap;line-height:1.5}@media print{body{margin:20mm}}</style>${esc(value)}`);
    w.document.close();
    setTimeout(()=>{w.focus();w.print();},250);
  }
}

async function imageBlob(url, type='image/png') {
  const res=await fetch(url);
  const src=await res.blob();
  if(type==='image/png' && src.type==='image/png') return src;
  const bitmap=await createImageBitmap(src);
  const canvas=document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height;
  canvas.getContext('2d').drawImage(bitmap,0,0);
  return await new Promise(resolve=>canvas.toBlob(resolve,type,type==='image/jpeg'?0.94:undefined));
}
async function saveImage(url, ext) { const type=ext==='jpg'?'image/jpeg':'image/png'; saveBlob(await imageBlob(url,type),`${baseName()}.${ext}`); }
async function shareImage(url) {
  const blob=await imageBlob(url,'image/png'); const file=new File([blob],`${baseName()}.png`,{type:'image/png'});
  if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) return navigator.share({files:[file],title:'VetroAI image'});
  saveBlob(blob,file.name);
}

function menu(items, x, y) {
  document.querySelector('.vetro-download-menu')?.remove();
  const el=document.createElement('div'); el.className='vetro-download-menu';
  Object.assign(el.style,{position:'fixed',zIndex:999999,left:`${Math.min(x,innerWidth-220)}px`,top:`${Math.min(y,innerHeight-340)}px`,width:'205px',padding:'7px',borderRadius:'12px',background:'#111113',border:'1px solid #303034',boxShadow:'0 12px 35px rgba(0,0,0,.45)'});
  items.forEach(([label,fn])=>{const b=document.createElement('button');b.textContent=label;Object.assign(b.style,{display:'block',width:'100%',padding:'9px 10px',border:0,borderRadius:'8px',background:'transparent',color:'#eee',textAlign:'left',font:'13px system-ui',cursor:'pointer'});b.onmouseenter=()=>b.style.background='#242428';b.onmouseleave=()=>b.style.background='transparent';b.onclick=async()=>{el.remove();try{await fn();}catch(e){alert(e.message||'Download failed');}};el.appendChild(b);});
  document.body.appendChild(el); setTimeout(()=>document.addEventListener('click',()=>el.remove(),{once:true}),0);
}

function enhance() {
  document.querySelectorAll('.msg-row').forEach(row=>{
    if(row.dataset.downloadEnhanced) return;
    const text=row.innerText?.trim(); if(!text) return;
    const host=row.querySelector('.msg-actions') || row;
    const b=document.createElement('button'); b.type='button'; b.textContent='↓'; b.title='Download response'; b.setAttribute('aria-label','Download response'); b.className='vetro-export-btn';
    Object.assign(b.style,{marginLeft:'6px',width:'30px',height:'30px',borderRadius:'8px',border:'1px solid #303034',background:'#111113',color:'#ddd',cursor:'pointer'});
    b.onclick=e=>{e.stopPropagation();menu([['PDF',()=>exportText(text,'pdf')],['Word (.doc)',()=>exportText(text,'doc')],['Spreadsheet (.xls)',()=>exportText(text,'xls')],['CSV',()=>exportText(text,'csv')],['Text (.txt)',()=>exportText(text,'txt')],['Markdown (.md)',()=>exportText(text,'md')],['JSON',()=>exportText(text,'json')],['HTML',()=>exportText(text,'html')]],e.clientX,e.clientY);};
    host.appendChild(b); row.dataset.downloadEnhanced='1';
  });
  document.querySelectorAll('img').forEach(img=>{
    if(img.dataset.vetroImageActions || !img.src || img.width<180 || img.height<120) return;
    const row=img.closest('.msg-row'); if(!row) return;
    const wrap=document.createElement('span'); wrap.style.cssText='display:inline-flex;gap:6px;margin:7px 0 0 7px;vertical-align:top';
    const make=(label,title,fn)=>{const b=document.createElement('button');b.textContent=label;b.title=title;b.style.cssText='border:1px solid #303034;background:#111113;color:#eee;border-radius:8px;padding:7px 9px;cursor:pointer';b.onclick=e=>{e.stopPropagation();fn().catch(err=>alert(err.message||"Action failed"));};return b;};
    wrap.append(make('PNG','Download PNG',()=>saveImage(img.src,'png')),make('JPG','Download JPG',()=>saveImage(img.src,'jpg')),make('Share','Share image',()=>shareImage(img.src)));
    img.insertAdjacentElement('afterend',wrap); img.dataset.vetroImageActions='1';
  });
}

if(typeof window!=='undefined'){new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',enhance);setInterval(enhance,1800);}
