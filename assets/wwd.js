/* What we do / Research / Company pages: scroll reveal, the interactive
   widgets (data in window.__WWD__ on the page), the boundary scrolly and the
   tap-to-open stage cards. Was pasted inline into 57 pages in three language
   variants; the words now follow <html lang>. */
(function(){
const DOC=document;
const T=document.documentElement.lang==='ar'?{
  scope:['خارج النطاق','','متأثرة'],held:['غائب','جزئي','متوفر'],survive:['مفقودة','مشروطة','تنجو'],
  question:'سؤال ',node:'العقدة '
}:{
  scope:['NOT IN SCOPE','','TOUCHED'],held:['ABSENT','PARTIAL','HELD'],survive:['LOST','CONDITIONAL','SURVIVES'],
  question:'Question ',node:'NODE '
};
function reveal(root){root.querySelectorAll('.rv').forEach(function(el){
  if(el.getBoundingClientRect().top<innerHeight*1.1)el.classList.add('in');else wio.observe(el);});}
const wio=new IntersectionObserver(function(es){es.forEach(function(e){
  if(e.isIntersecting){e.target.classList.add('in');wio.unobserve(e.target)}})},{threshold:.08});
/* ================= WHAT-WE-DO: widgets ================= */
const DATA=window.__WWD__||{};
function initWidgets(root){
  root.querySelectorAll('[data-w]').forEach(sec=>{
    if(sec.dataset.ready)return; sec.dataset.ready='1';
    const d=DATA[sec.id]; if(!d)return;
    (({lay:wLay,led:wLed,lad:wLad,pth:wPth,blast:wBlast,map:wMap})[sec.dataset.w])(sec,d);
  });
}
function P(sec){return{
  name:sec.querySelector('.bname'),desc:sec.querySelector('.bdesc'),
  verd:sec.querySelector('.bverd'),cnt:sec.querySelector('.cnt b'),
  meter:[...(sec.querySelector('.meter')?sec.querySelector('.meter').children:[])],
  chips:[...sec.querySelectorAll('.ev')],cards:[...sec.querySelectorAll('.cpy')],
  fields:sec.querySelector('.bfields')};}
function idle(sec){const p=P(sec);return{n:p.name.textContent,d:p.desc.textContent,v:p.verd.textContent};}
function bind(p,fn){p.chips.forEach((b,i)=>b.addEventListener('click',()=>fn(i,b)));}
function setChips(p,i){p.chips.forEach((b,k)=>{b.classList.toggle('act',k===i);b.setAttribute('aria-pressed',k===i)});}
function meter(p,on,cnd){p.meter.forEach((m,k)=>{m.classList.remove('on','cnd');
  setTimeout(()=>{if(k<on)m.classList.add('on');else if(k<on+(cnd||0))m.classList.add('cnd')},110+k*65)});}

/* --- LAYER STACK & EVIDENCE LEDGER share the .cpy stage --- */
function stageWidget(sec,rows,labels){
  const p=P(sec),I=idle(sec);let cur=-1;
  function reset(){cur=-1;setChips(p,-1);
    p.cards.forEach(c=>{c.classList.remove('safe','cond','lost');
      c.querySelector('.sv').textContent='';c.querySelector('.rs').textContent='';});
    p.name.textContent=I.n;p.desc.textContent=I.d;p.verd.textContent=I.v;
    p.verd.classList.add('idle');p.cnt.innerHTML='&#8212;';meter(p,0,0);}
  bind(p,i=>{
    if(cur===i){reset();return}
    cur=i;const r=rows[i];setChips(p,i);
    let a=0,b=0;
    p.cards.forEach((c,k)=>{const s=r.s[k];
      c.classList.remove('safe','cond','lost');
      c.classList.add(s===2?'safe':s===1?'cond':'lost');
      c.querySelector('.sv').textContent=labels[s];
      c.querySelector('.rs').textContent=r.r[k];
      if(s===2)a++;else if(s===1)b++;});
    p.name.textContent=r.n;p.desc.textContent=r.d;
    p.verd.textContent=r.v;p.verd.classList.remove('idle');
    p.cnt.textContent=a;meter(p,a,b);});
}
function wLay(sec,d){
  // layer stack: 1 = touched, 0 = out of scope  (map to cond/lost, count touched)
  const rows=d.reqs.map(r=>({n:r.n,d:r.d,v:r.v,r:r.r,s:r.s.map(x=>x?2:0)}));
  stageWidget(sec,rows,T.scope);
}
function wLed(sec,d){
  stageWidget(sec,d.obs,T.held);
}

function wBlast(sec,d){
  stageWidget(sec,d.obs,T.survive);
}

/* --- THE TWELVE-QUESTION MAP --- */
function wMap(sec,d){
  const stage=sec.querySelector('.stage'),
        pz=sec.querySelector('.pz'),pq=sec.querySelector('.pq'),pw=sec.querySelector('.pw'),
        mark=sec.querySelector('.mark'),bY=sec.querySelector('.mark .y'),bN=sec.querySelector('.mark .n'),
        ansN=sec.querySelector('.ansN'),verdict=sec.querySelector('.verdict');
  const N=d.nodes,state=N.map(()=>null);let cur=-1;
  N.forEach((n,i)=>{
    const b=document.createElement('button');
    b.className='nd'+(i===0?' pulse':'');b.type='button';
    b.style.left=n.x+'%';b.style.top=n.y+'%';
    b.setAttribute('aria-label',T.question+(i+1)+': '+n.q);
    b.innerHTML='<span>'+String(i+1).padStart(2,'0')+'</span>';
    b.addEventListener('click',()=>openNode(i));
    stage.appendChild(b);
  });
  const btns=()=>[...stage.querySelectorAll('.nd')];
  function openNode(i){
    cur=i;const n=N[i];
    btns().forEach((b,j)=>{b.classList.remove('on','pulse');
      if(j===i)b.classList.add('on');
      b.classList.toggle('ok',state[j]===true);});
    btns()[i].classList.add('seen');
    pz.textContent=n.z+'  \u00b7  '+T.node+String(i+1).padStart(2,'0');
    pq.textContent=n.q;pq.classList.remove('idle');pw.textContent=n.w;
    mark.hidden=false;
    bY.classList.toggle('act',state[i]===true);
    bN.classList.toggle('act',state[i]===false);
  }
  function setAns(v){
    if(cur<0)return;
    state[cur]=state[cur]===v?null:v;
    bY.classList.toggle('act',state[cur]===true);
    bN.classList.toggle('act',state[cur]===false);
    btns()[cur].classList.toggle('ok',state[cur]===true);
    const yes=state.filter(x=>x===true).length,done=state.filter(x=>x!==null).length;
    ansN.textContent=yes;
    if(done<3){verdict.textContent=d.verdict;return}
    for(const [t,txt] of d.scores){if(yes>=t){verdict.textContent=txt;return}}
  }
  bY.addEventListener('click',()=>setAns(true));
  bN.addEventListener('click',()=>setAns(false));
}

/* --- AUTONOMY LADDER --- */
function wLad(sec,d){
  const p=P(sec),I=idle(sec),rungs=[...sec.querySelectorAll('.rng')];let cur=-1;
  const F=[['WHAT A PERSON STILL DECIDES','human'],
           ['WHAT MUST BE EVIDENCED','ev'],['WHAT BREAKS IF YOU SKIP IT','fail']];
  function reset(){cur=-1;rungs.forEach(r=>r.classList.remove('pass','here','above'));
    p.name.textContent=I.n;p.desc.textContent=I.d;p.verd.textContent=I.v;
    p.verd.classList.add('idle');p.cnt.innerHTML='&#8212;';p.fields.innerHTML='';meter(p,0,0);}
  rungs.forEach((el,i)=>el.addEventListener('click',()=>{
    if(cur===i){reset();return}
    cur=i;const r=d.rungs[i];
    rungs.forEach((x,k)=>{x.classList.remove('pass','here','above');
      x.classList.add(k<i?'pass':k===i?'here':'above')});
    p.name.textContent='Rung 0'+(i+1)+' — '+r.n;
    p.desc.textContent=r.does;
    p.fields.innerHTML=F.map(([k,f],j)=>
      '<div class="bf'+(j===2?' warn':'')+'"><div class="k">'+k+'</div><p>'+r[f]+'</p></div>').join('');
    p.verd.textContent=d.verdict;p.verd.classList.remove('idle');
    p.cnt.textContent=i+1;meter(p,i+1,0);}));
  reset();
}

/* --- ATTACK PATH --- */
function wPth(sec,d){
  const p=P(sec),I=idle(sec),steps=[...sec.querySelectorAll('.pst')];let cur=-1,tm=[];
  function clear(){tm.forEach(clearTimeout);tm=[];steps.forEach(s=>{s.classList.remove('lit');
    s.querySelector('.t').textContent='';s.querySelector('h4').textContent='';
    const g=s.querySelector('.gate');g.textContent='';g.className='gate';});}
  function reset(){cur=-1;setChips(p,-1);clear();
    p.name.textContent=I.n;p.desc.textContent=I.d;p.verd.textContent=I.v;
    p.verd.classList.add('idle');p.cnt.innerHTML='&#8212;';}
  bind(p,i=>{
    if(cur===i){reset();return}
    cur=i;const v=d.vectors[i];setChips(p,i);clear();
    let yes=0;
    v.st.forEach(s=>{if(/present/i.test(s[2]))yes++});
    v.st.forEach((s,k)=>{tm.push(setTimeout(()=>{
      const el=steps[k];el.classList.add('lit');
      el.querySelector('.t').textContent=s[0].toUpperCase();
      el.querySelector('h4').textContent=s[1];
      const g=el.querySelector('.gate');g.textContent=s[2].toUpperCase();
      g.className='gate '+(/usually absent/i.test(s[2])?'no':/not applicable/i.test(s[2])?'na':'yes');
    },160+k*230));});
    p.name.textContent=v.n;p.desc.textContent=v.d;
    p.verd.textContent=v.v;p.verd.classList.remove('idle');
    p.cnt.textContent=yes+' / 5';});
  reset();
}

/* ================= WHAT-WE-DO: boundary scrolly ================= */
function setDia(svg,i){if(!svg)return;svg.querySelectorAll('.g').forEach(g=>g.classList.remove('on'));
  const g=svg.querySelector('.g'+i);if(g)g.classList.add('on');}
function initScrolly(root){
  root.querySelectorAll('[data-scrolly]').forEach(sc=>{
    if(sc.dataset.ready)return;sc.dataset.ready='1';
    const svg=sc.querySelector('.dia'),steps=[...sc.querySelectorAll('.stp')];
    const obs=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;
      steps.forEach(s=>s.classList.remove('act'));e.target.classList.add('act');
      setDia(svg,+e.target.dataset.i);}),{rootMargin:'-45% 0px -45% 0px',threshold:0});
    steps.forEach(s=>obs.observe(s));
    steps[0].classList.add('act');setDia(svg,1);
  });
}
/* ================= WHAT-WE-DO: stage cards on touch ================= */
document.addEventListener('click',e=>{
  const c=e.target.closest('.wwd .stg .st');if(!c)return;
  const was=c.classList.contains('open');
  c.closest('.stg').querySelectorAll('.st').forEach(o=>{o.classList.remove('open');o.setAttribute('aria-expanded','false')});
  if(!was){c.classList.add('open');c.setAttribute('aria-expanded','true')}
});
const root=document.querySelector('.wwd')||document.body;
reveal(root); initWidgets(root); initScrolly(root);
})();
