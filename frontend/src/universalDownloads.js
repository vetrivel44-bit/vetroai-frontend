// VetroAI universal downloads.
// One compact download icon is used everywhere. It opens a format picker and downloads
// real content instead of navigating to a blank print page.

const saveBlob=(blob,filename)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)};
const clean=(s='')=>String(s).replace(/\r/g,'').trim();
const baseName=()=>`vetroai-${new Date().toISOString().replace(/[:.]/g,'-')}`;
const FORMAT_RULES=[['pdf',/\b(pdf|portable document)\b/i],['doc',/\b(word|docx?|document file)\b/i],['xls',/\b(excel|xlsx?|spreadsheet)\b/i],['csv',/\bcsv\b/i],['txt',/\b(txt|text file)\b/i],['md',/\b(markdown|\.md)\b/i],['json',/\bjson\b/i],['html',/\b(html|web page file)\b/i]];
function requestedFormats(text=''){return FORMAT_RULES.filter(([,r])=>r.test(text)).map(([f])=>f)}
function isFileRequest(text=''){return /\b(download|export|save|give|provide|create|make|generate|send|convert)\b/i.test(text)&&requestedFormats(text).length>0}
function label(f){return({pdf:'PDF',doc:'Word',xls:'Spreadsheet',csv:'CSV',txt:'Text',md:'Markdown',json:'JSON',html:'HTML',png:'PNG',jpg:'JPG',webp:'WebP'})[f]||f.toUpperCase()}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function textLines(value){return clean(value).split('\n').map(x=>x.trimEnd())}

async function exportText(text,format){
 const value=clean(text),name=baseName(); if(!value)throw new Error('There is no content to export.');
 if(format==='txt')return saveBlob(new Blob([value],{type:'text/plain;charset=utf-8'}),`${name}.txt`);
 if(format==='md')return saveBlob(new Blob([value],{type:'text/markdown;charset=utf-8'}),`${name}.md`);
 if(format==='json')return saveBlob(new Blob([JSON.stringify({content:value},null,2)],{type:'application/json'}),`${name}.json`);
 if(format==='html')return saveBlob(new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>VetroAI</title></head><body><article style="max-width:850px;margin:40px auto;font:16px system-ui;white-space:pre-wrap">${esc(value)}</article></body></html>`],{type:'text/html;charset=utf-8'}),`${name}.html`);
 if(format==='csv'){const csv=textLines(value).filter(Boolean).map(v=>`"${v.replace(/"/g,'""')}"`).join('\r\n');return saveBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`${name}.csv`)}
 if(format==='doc'){const html=`<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font:11pt Arial;white-space:pre-wrap">${esc(value)}</div></body></html>`;return saveBlob(new Blob(['\ufeff',html],{type:'application/msword'}),`${name}.doc`)}
 if(format==='xls'){const rows=textLines(value).filter(Boolean).map(line=>`<tr><td>${esc(line)}</td></tr>`).join('');const html=`<html><head><meta charset="utf-8"></head><body><table>${rows}</table></body></html>`;return saveBlob(new Blob(['\ufeff',html],{type:'application/vnd.ms-excel'}),`${name}.xls`)}
 if(format==='pdf'){
   const {jsPDF}=await import('jspdf'); const pdf=new jsPDF({unit:'pt',format:'a4'}); const margin=44,maxWidth=507,lineHeight=17; let y=52;
   const lines=pdf.splitTextToSize(value,maxWidth); for(const line of lines){if(y>790){pdf.addPage();y=52}pdf.text(String(line),margin,y);y+=lineHeight} pdf.save(`${name}.pdf`); return;
 }
 throw new Error(`Unsupported format: ${format}`);
}

async function imageBlob(url,type='image/png'){
 const res=await fetch(url); if(!res.ok)throw new Error('Could not load the image for download.'); const src=await res.blob();
 if(type===src.type)return src; const bitmap=await createImageBitmap(src),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);
 return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image conversion failed.')),type,type==='image/jpeg'?.94:undefined));
}
async function saveImage(url,ext){const types={jpg:'image/jpeg',png:'image/png',webp:'image/webp'};saveBlob(await imageBlob(url,types[ext]),`${baseName()}.${ext}`)}
async function shareImage(url){const blob=await imageBlob(url),file=new File([blob],`${baseName()}.png`,{type:'image/png'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]})))return navigator.share({files:[file],title:'VetroAI image'});saveBlob(blob,file.name)}

function menu(items,x,y){document.querySelector('.vetro-download-menu')?.remove();const el=document.createElement('div');el.className='vetro-download-menu';Object.assign(el.style,{position:'fixed',zIndex:999999,left:`${Math.max(8,Math.min(x,innerWidth-220))}px`,top:`${Math.max(8,Math.min(y,innerHeight-330))}px`,width:'205px',padding:'7px',borderRadius:'12px',background:'#111113',border:'1px solid #303034',boxShadow:'0 12px 35px rgba(0,0,0,.35)'});items.forEach(([name,fn])=>{const b=document.createElement('button');b.textContent=name;b.style.cssText='display:block;width:100%;padding:10px;border:0;border-radius:8px;background:transparent;color:#eee;text-align:left;cursor:pointer';b.onmouseenter=()=>b.style.background='#222226';b.onmouseleave=()=>b.style.background='transparent';b.onclick=async ev=>{ev.stopPropagation();el.remove();try{await fn()}catch(e){alert(e.message||'Download failed')}};el.appendChild(b)});document.body.appendChild(el);setTimeout(()=>document.addEventListener('click',()=>el.remove(),{once:true}),0)}
function previousUserText(row){let n=row.previousElementSibling;while(n){const t=n.innerText?.trim()||'';if(t&&!n.querySelector('.response-model-icon'))return t;n=n.previousElementSibling}return ''}
function iconButton(title){const b=document.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',title);b.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';b.className='vetro-export-btn';b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;background:transparent;color:inherit;opacity:.78;cursor:pointer;border-radius:7px';return b}
function removeLegacyImageButtons(row){row.querySelectorAll('button').forEach(b=>{const t=(b.textContent||'').trim().toLowerCase();if(t==='png'||t==='jpg'||t==='jpeg'||t==='download')b.remove()})}
function nearestActions(row,img){return row.querySelector('.msg-actions,.message-actions,.response-actions,.action-buttons')||img.parentElement||row}

function enhance(){
 document.querySelectorAll('.msg-row').forEach(row=>{
   const text=row.innerText?.trim(); if(!text)return;
   if(!row.dataset.downloadEnhanced){const request=previousUserText(row),formats=requestedFormats(request);if(isFileRequest(request)&&formats.length){const host=row.querySelector('.msg-actions,.message-actions,.response-actions')||row,b=iconButton(`Download ${formats.map(label).join(' / ')}`);b.onclick=e=>{e.stopPropagation();const items=formats.map(f=>[label(f),()=>exportText(text,f)]);if(items.length===1)items[0][1]();else menu(items,e.clientX,e.clientY)};host.appendChild(b)}row.dataset.downloadEnhanced='1'}
   row.querySelectorAll('img').forEach(img=>{if(img.dataset.vetroImageActions||!img.src||img.width<180||img.height<120)return;removeLegacyImageButtons(row);const host=nearestActions(row,img),b=iconButton('Download image');b.classList.add('vetro-image-download');b.onclick=e=>{e.stopPropagation();menu([['PNG',()=>saveImage(img.src,'png')],['JPG',()=>saveImage(img.src,'jpg')],['WebP',()=>saveImage(img.src,'webp')]],e.clientX,e.clientY)};
     const share=[...host.querySelectorAll('button')].find(x=>(x.title||x.getAttribute('aria-label')||x.textContent||'').toLowerCase().includes('share'));if(share)share.insertAdjacentElement('beforebegin',b);else host.appendChild(b);img.dataset.vetroImageActions='1';
   });
 });
}
if(typeof window!=='undefined'){new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',enhance);setInterval(enhance,1200)}
