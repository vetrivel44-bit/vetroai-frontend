(() => {
  const safeName = (s, ext) => `${String(s || 'vetroai-output').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,50) || 'vetroai-output'}.${ext}`;
  const downloadBlob = (blob, name) => { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); };
  const textOf = row => row.querySelector('.msg-row')?.innerText?.trim() || '';
  const titleOf = text => (text.split('\n').find(Boolean) || 'VetroAI output').replace(/^#+\s*/, '').slice(0,60);

  function downloadText(text, type) {
    const title=titleOf(text);
    if(type==='pdf' && window.jspdf?.jsPDF){ const doc=new window.jspdf.jsPDF(); const lines=doc.splitTextToSize(text,180); let y=15; for(const line of lines){ if(y>280){doc.addPage();y=15;} doc.text(line,15,y); y+=6;} doc.save(safeName(title,'pdf')); return; }
    if(type==='doc'){ const html=`<!doctype html><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><pre style="white-space:pre-wrap;font:11pt Arial">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre></body>`; downloadBlob(new Blob([html],{type:'application/msword'}),safeName(title,'doc')); return; }
    if(type==='csv'){ const rows=text.split('\n').filter(Boolean).map(line=>line.split(/\s*\|\s*|\t|\s{2,}/).map(v=>`"${v.replace(/"/g,'""')}"`).join(',')); downloadBlob(new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8'}),safeName(title,'csv')); return; }
    downloadBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),safeName(title,'txt'));
  }

  async function shareImage(src){
    try { const r=await fetch(src); const blob=await r.blob(); const ext=blob.type.includes('png')?'png':'jpg'; const file=new File([blob],safeName('vetroai-image',ext),{type:blob.type||'image/png'}); if(navigator.canShare?.({files:[file]})){ await navigator.share({files:[file],title:'VetroAI image'}); return; } await navigator.share?.({title:'VetroAI image',url:src}); } catch { try{await navigator.clipboard.writeText(src);}catch{} }
  }
  async function downloadImage(src){ try{const r=await fetch(src);const b=await r.blob();downloadBlob(b,safeName('vetroai-image',b.type.includes('png')?'png':'jpg'));}catch{const a=document.createElement('a');a.href=src;a.download='vetroai-image.png';a.click();} }

  // The bar goes after the image, or after the link or button around it: inside
  // one, tapping Download would also follow the link. It remembers its image:
  // React replaces an image while a reply streams (e.g. when the closing
  // "](link)" arrives), and sync() then drops the old image's bar.
  const only=fn=>e=>{ e.preventDefault(); e.stopPropagation(); fn(); };
  function addImageTools(img){ if(img.dataset.vetroTools)return; img.dataset.vetroTools='1'; const anchor=img.closest('a,button'); const host=anchor && anchor.closest('.msg-row, [class*=message]') ? anchor : img; const bar=document.createElement('div'); bar.className='vetro-image-actions'; bar._vetroImg=img; bar.innerHTML='<button type="button">Download</button><button type="button">Share</button>'; bar.children[0].onclick=only(()=>downloadImage(img.src)); bar.children[1].onclick=only(()=>shareImage(img.src)); host.insertAdjacentElement('afterend',bar); }
  function addOutputTools(row){ if(row.dataset.vetroExports)return; const text=textOf(row); if(!text || text==='Generating your image...')return; row.dataset.vetroExports='1'; const bar=document.createElement('div'); bar.className='vetro-export-actions'; ['PDF','Word','Spreadsheet'].forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>downloadText(textOf(row),['pdf','doc','csv'][i]);bar.appendChild(b);}); row.appendChild(bar); }
  // Download/Share are for pictures (generated images, photos, charts), never
  // for icons: site icons in citations, source cards and DeepSearch's research
  // card, logos, crests, model icons, badges, map tiles. Components mark their
  // icons with data-no-image-tools. Anything else is judged once it has loaded
  // and is drawn: by its drawn size, since a favicon.ico or a team crest can be
  // 256px but is drawn at 16-40px, and by its shortest side, which catches
  // badges and tracking pixels. Until it is drawn (a hidden or collapsed
  // container reports 0x0) it is looked at again later.
  // Gallery thumbnails sit in a clipped box (the bar would be invisible); their
  // full-size view gets the bar.
  const ICON_AREAS='[data-no-image-tools], .px-src, .vai-cite, .vai-ra, .ls-card, .gallery-image-container, .vetro-diagram, .vetro-visual, .maplibregl-map';
  const ICON_MAX=96, THIN_MAX=64;
  const isIcon=img=>img.classList.contains('response-model-icon') || img.classList.contains('px-src-favicon') || !!img.closest(ICON_AREAS);
  function considerImage(img){
    const src=img.currentSrc || img.src;
    if(img.dataset.vetroTools || img.dataset.vetroChecked===src) return;
    if(!img.complete || !img.naturalWidth){
      if(img.dataset.vetroWaiting!==src){ img.dataset.vetroWaiting=src; img.addEventListener('load',()=>requestAnimationFrame(sync),{once:true}); }
      return;
    }
    if(Math.min(img.naturalWidth,img.naturalHeight)<THIN_MAX){ img.dataset.vetroChecked=src; return; }
    const r=img.getBoundingClientRect();
    if(!r.width || !r.height){ whenDrawn?.observe(img); return; }
    whenDrawn?.unobserve(img);
    img.dataset.vetroChecked=src;
    if(r.width>ICON_MAX || r.height>ICON_MAX) addImageTools(img);
  }
  // An image that is not drawn yet (in a hidden or closed container) is looked
  // at again as soon as it gets a size, even if nothing else changes.
  const whenDrawn=window.ResizeObserver ? new ResizeObserver(entries=>{ if(entries.some(e=>e.contentRect.width && e.contentRect.height)) requestAnimationFrame(sync); }) : null;
  function sync(){ document.querySelectorAll('.vetro-image-actions').forEach(bar=>{ if(bar._vetroImg && !bar._vetroImg.isConnected) bar.remove(); }); document.querySelectorAll('img').forEach(img=>{ if(img.src && (img.closest('.msg-row') || img.closest('[class*=message]')) && !isIcon(img)) considerImage(img); }); }
  new MutationObserver(()=>requestAnimationFrame(sync)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']}); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();