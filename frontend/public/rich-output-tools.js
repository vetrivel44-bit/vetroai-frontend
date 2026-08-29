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

  function addImageTools(img){ if(img.dataset.vetroTools)return; img.dataset.vetroTools='1'; const wrap=img.parentElement; if(!wrap)return; const bar=document.createElement('div'); bar.className='vetro-image-actions'; bar.innerHTML='<button type="button">Download</button><button type="button">Share</button>'; bar.children[0].onclick=()=>downloadImage(img.src); bar.children[1].onclick=()=>shareImage(img.src); wrap.appendChild(bar); }
  function addOutputTools(row){ if(row.dataset.vetroExports)return; const text=textOf(row); if(!text || text==='Generating your image...')return; row.dataset.vetroExports='1'; const bar=document.createElement('div'); bar.className='vetro-export-actions'; ['PDF','Word','Spreadsheet'].forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>downloadText(textOf(row),['pdf','doc','csv'][i]);bar.appendChild(b);}); row.appendChild(bar); }
  function sync(){ document.querySelectorAll('.msg-row').forEach(row=>{ if(row.previousElementSibling) addOutputTools(row); }); document.querySelectorAll('img').forEach(img=>{ if(img.src && (img.closest('.msg-row') || img.closest('[class*=message]')) && !img.classList.contains('response-model-icon')) addImageTools(img); }); }
  new MutationObserver(()=>requestAnimationFrame(sync)).observe(document.documentElement,{subtree:true,childList:true}); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();