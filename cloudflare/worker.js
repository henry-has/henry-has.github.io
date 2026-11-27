// Spotweld leaderboard. Re-scores every submitted layout with the game's own solver
// (inlined below from spotweld/index.html by build.py), so only the layout is trusted, never a score.
const SQ3=Math.sqrt(3);
const RC=10;      // mΩ per cell
const RL=1.0;     // mΩ per strip
const ICELL=15;   // A per cell
const VCELL=3.6, AHCELL=4.2; // nominal 21700
const PREF=ICELL*ICELL*RL/1000; // W in one link carrying one cell's current
const HEATMAX=PREF*2.25;
let SPLIT_COST=0.1; // per extra island in a group
const UNEVEN_W=0.5; // weight on the busiest cell's extra heat
const HOT_I=1.02; // strips carrying more than one cell's current glow: yellow just over, red by 2×
const PAL=['#4cc9f0','#f72585','#a7e36f','#ffb703','#9d6bff','#06d6a0','#fb8500','#5b7cff','#ff6b8b','#7fe3f0','#d08cff','#ffd166','#3ddc84','#ff8fab'];

const LB_URL='https://spotweld.henry-has.workers.dev'; // leaderboard Worker
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

/* ---------- shapes ---------- */
function fromDW(rows){const c=[];rows.forEach((row,r)=>{for(let k=0;k<row.length;k++)if(row[k]==='o')c.push({x:k/2,y:r*SQ3/2});});return c;}
function fromGrid(rows){const c=[];rows.forEach((row,r)=>{for(let k=0;k<row.length;k++)if(row[k]==='#')c.push({x:k,y:r});});return c;}
// rows of hex cells: counts[r] cells starting at x0(r)
function fromRows(counts,x0=r=>(r%2)/2){const c=[];counts.forEach((n,r)=>{for(let k=0;k<n;k++)c.push({x:x0(r)+k,y:r*SQ3/2});});return c;}
function axial(q,r){return {x:q+r/2,y:r*SQ3/2};}
function hexagon(R,hole=-1){const c=[];for(let q=-R;q<=R;q++)for(let r=-R;r<=R;r++){const d=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));if(d<=R&&d>hole)c.push(axial(q,r));}return c;}

const DEMOS=[
 {id:'pairs',name:'Pairs',S:3,P:2,grid:true,optimal:true,learn:1,cells:fromGrid(['###','###']),
  blurb:'Parallel cells share current; series groups pass it on, S1 → S2 → S3.',
  lesson:'Series adds voltage, parallel splits current.'},
 {id:'lines',name:'Lines',S:4,P:3,optimal:true,learn:1,cells:fromDW(['o o o o',' o o o o','o o o o']),
  blurb:'Every touching pair between groups is another path for current.',
  lesson:'Maximise contact between neighbouring groups.'},
 {id:'neck',name:'Neck',S:6,P:3,learn:1,cells:fromDW(['o o o     o o o',' o o o o o o','o o o     o o o']),
  blurb:'Full pack current crosses the narrowest link.',
  lesson:'Fewer strips per link means more heat per strip. Spend the neck on series links.'},
 {id:'corner',name:'Corner',S:8,P:2,grid:true,learn:1,cells:fromGrid(['##....','##....','######','######']),
  blurb:'Geometry skews current. Find the busiest cell.',
  lesson:'The busiest cell sets the pack\'s thermal limit and lifetime.'},
 {id:'uturn',learn:1,lesson:'A split group can share current better than a compact one.',name:'U-Turn',S:6,P:2,grid:true,cells:fromGrid(['#..#','#..#','#..#','#..#','####']),
  blurb:'Groups need not be contiguous. Splitting costs a little, and less in packs with more series groups.'},
 {id:'wedgejr',name:'Wedge Jr',S:9,P:4,cells:fromRows([8,7,6,5,4,3,2,1])},
 {id:'wedge',name:'Wedge',S:14,P:6,cells:fromRows([13,12,12,10,9,7,6,5,4,3,2,1])},
 {id:'hive',name:'Hive',S:9,P:4,cells:hexagon(3,0)},
 {id:'para3',name:'Parallelogram',S:15,P:4,cells:fromRows([10,10,10,10,10,10],r=>r/2)},
];

/* ---------- daily ---------- */
function hashStr(s){let h=2166136261;for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const today=new Date();
const dKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const dayNo=Math.round((new Date(today.getFullYear(),today.getMonth(),today.getDate())-new Date(2026,10,24))/864e5)+1;
/* ---------- level prep ---------- */
function prepLevel(L){
  const xs=L.cells.map(c=>c.x),ys=L.cells.map(c=>c.y);
  const mx=Math.min(...xs),my=Math.min(...ys);
  L.cells=L.cells.map(c=>({x:c.x-mx,y:c.y-my}));
  L.w=Math.max(...xs)-mx;L.h=Math.max(...ys)-my;
  const th=L.grid?1.5:1.05;
  L.pairs=[];L.nb=L.cells.map(()=>[]);
  for(let i=0;i<L.cells.length;i++)for(let j=i+1;j<L.cells.length;j++){
    const d=Math.hypot(L.cells[i].x-L.cells[j].x,L.cells[i].y-L.cells[j].y);
    if(d<th){L.pairs.push({i,j,d});L.nb[i].push(j);L.nb[j].push(i);}
  }
  if(L.cells.length!==L.S*L.P) console.warn(L.name,'has',L.cells.length,'cells, need',L.S*L.P);
  return L;
}
function isConnected(L){const seen=new Set([0]),st=[0];while(st.length){const i=st.pop();for(const j of L.nb[i])if(!seen.has(j)){seen.add(j);st.push(j);}}return seen.size===L.cells.length;}

/* ---------- physics ---------- */
function evaluate(L,asg){
  const {S,P}=L,N=L.cells.length;
  const groups=Array.from({length:S},()=>[]);
  asg.forEach((g,i)=>{if(g>=0)groups[g].push(i);});
  let m=0;while(m<S&&groups[m].length===P)m++;
  const links=[];
  for(const pr of L.pairs){
    const gi=asg[pr.i],gj=asg[pr.j];if(gi<0||gj<0)continue;
    let plates=[];
    if(gi===gj)plates=[gi,gi+1];else if(Math.abs(gi-gj)===1)plates=[Math.max(gi,gj)];
    for(const p of plates)links.push({i:pr.i,j:pr.j,p,face:p%2,R:RL,bus:p===0||p===S,I:null,W:null});
  }
  // components & series contact
  const comps=groups.map(()=>0),touch=groups.map(()=>true);
  const seen=new Array(N).fill(false);
  for(let g=0;g<S;g++)for(const i of groups[g]){if(seen[i])continue;comps[g]++;const st=[i];seen[i]=true;while(st.length){const a=st.pop();for(const b of L.nb[a])if(!seen[b]&&asg[b]===g){seen[b]=true;st.push(b);}}}
  for(let g=1;g<S;g++){if(!groups[g].length||!groups[g-1].length)continue;touch[g]=L.pairs.some(pr=>{const a=asg[pr.i],b=asg[pr.j];return (a===g&&b===g-1)||(a===g-1&&b===g);});}
  const res={groups,m,links,comps,touch,cellI:new Array(N).fill(null),complete:m===S};
  if(m===0)return res;
  // nodes
  const idx=new Map();let U=0;
  const node=(i,p)=>{if(p===0)return -1;if(p===m)return -2;const k=i*2+(p===asg[i]?0:1);if(!idx.has(k))idx.set(k,U++);return idx.get(k);};
  const els=[];
  for(let g=0;g<m;g++)for(const i of groups[g])els.push({a:node(i,g),b:node(i,g+1),c:1/RC,cell:i});
  for(const l of links){
    if(asg[l.i]>=m||asg[l.j]>=m||l.p>m)continue;
    if(l.p===0||l.p===m){l.tbus=true;continue;}
    l.a=node(l.i,l.p);l.b=node(l.j,l.p);els.push({a:l.a,b:l.b,c:1/l.R,link:l});
  }
  const G=Array.from({length:U},()=>new Float64Array(U)),B=new Float64Array(U);
  for(const e of els){
    const {a,b,c}=e;
    if(a>=0)G[a][a]+=c;if(b>=0)G[b][b]+=c;
    if(a>=0&&b>=0){G[a][b]-=c;G[b][a]-=c;}
    if(a>=0&&b===-2)B[a]+=c;if(b>=0&&a===-2)B[b]+=c;
  }
  for(let k=0;k<U;k++)G[k][k]+=1e-9;
  const x=gauss(G,B,U);
  const V=n=>n===-1?0:n===-2?1:x[n];
  let It=0;const raw=new Array(N).fill(0);
  for(const e of els){const i=(V(e.a)-V(e.b))*e.c;if(e.cell!==undefined){raw[e.cell]=Math.abs(i);}else e.link.raw=Math.abs(i);}
  for(const i of groups[0])It+=raw[i];
  const Rp=1/It,Ri=m*RC/P,k=ICELL*P/It;
  res.Rpack=Rp;res.Rideal=Ri;res.open=Rp>40*Ri;
  let loss=0,hot=null;
  for(let g=0;g<m;g++)for(const i of groups[g])res.cellI[i]=raw[i]*k;
  for(const l of links)if(l.raw!==undefined){l.I=l.raw*k;l.W=l.I*l.I*l.R/1000;loss+=l.W;if(!hot||l.W>hot.W)hot=l;}
  res.loss=loss;res.hot=hot;
  // links between consecutive groups: heat-equivalent resistance and how evenly the strips share current
  const Ip=ICELL*P;res.junc=[];
  for(let q=1;q<m;q++){
    const js=links.filter(l=>l.p===q&&asg[l.i]!==asg[l.j]&&l.I!=null);
    if(!js.length){res.junc.push({q,n:0,R:Infinity,spread:0});continue;}
    const Wsum=js.reduce((a,l)=>a+l.W,0),Is=js.map(l=>l.I),mean=Is.reduce((a,b)=>a+b,0)/Is.length;
    res.junc.push({q,n:js.length,R:Wsum*1000/(Ip*Ip),ideal:RL/js.length,spread:Math.max(...Is)/mean-1});
  }
  res.gstat=groups.map((gr,g)=>{
    if(g>=m)return null;const I=gr.map(i=>res.cellI[i]);
    const mx=Math.max(...I),mn=Math.min(...I),mean=I.reduce((a,b)=>a+b,0)/I.length;
    return {I,mx,mn,mean,spread:(mx-mn)/mean};
  });
  const sp=res.gstat.slice(0,m).map(s=>s.spread);
  res.spreadMean=sp.reduce((a,b)=>a+b,0)/sp.length;res.spreadMax=Math.max(...sp);
  res.overhead=Rp/Ri-1;
  res.load=Math.max(...res.gstat.slice(0,m).map(s=>s.mx/s.mean)); // hardest-working cell vs its group average
  const done=comps.filter((c,g)=>groups[g].length);
  res.extra=comps.reduce((a,c)=>a+Math.max(0,c-1),0);
  res.splitF=1+SPLIT_COST*res.extra/S;
  if(res.complete){
    // effective resistance (mΩ, lower is better): pack resistance, scaled by the worst cell's extra heat (∝ I²) and by splits
    res.uf=1+UNEVEN_W*(res.load*res.load-1);
    res.total=res.open?Infinity:Rp*res.uf*res.splitF;
  }
  return res;
}
function gauss(A,b,n){
  // the conductance matrix is symmetric positive definite and sparse: eliminate without pivoting and skip zeros
  const M=A,B=Float64Array.from(b),lo=new Int32Array(n),hi=new Int32Array(n);
  for(let r=0;r<n;r++){let a=r,z=r;const R=M[r];for(let k=0;k<n;k++)if(R[k]!==0){if(k<a)a=k;if(k>z)z=k;}lo[r]=a;hi[r]=z;}
  for(let c=0;c<n;c++){const Rc=M[c],pv=Rc[c];if(Math.abs(pv)<1e-18)continue;const hc=hi[c];
    for(let r=c+1;r<n;r++){if(lo[r]>c)continue;const Rr=M[r],f=Rr[c]/pv;if(f===0)continue;
      for(let k=c;k<=hc;k++)Rr[k]-=f*Rc[k];B[r]-=f*B[c];if(hc>hi[r])hi[r]=hc;}}
  const x=new Float64Array(n);
  for(let r=n-1;r>=0;r--){const R=M[r];let s=B[r];for(let k=r+1;k<=hi[r];k++)s-=R[k]*x[k];x[r]=Math.abs(R[r])<1e-18?0:s/R[r];}
  return x;
}


const CACHE={};
const level=id=>{if(!CACHE[id]){const d=DEMOS.find(x=>x.id===id);if(!d)return null;CACHE[id]=prepLevel(JSON.parse(JSON.stringify(d)));}return CACHE[id];};
const H={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','content-type':'application/json'};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:H});
const top=(list,n)=>list.slice(0,n).map(e=>({name:e.name,score:e.score,layout:e.layout,t:e.t}));

export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(req.method==='OPTIONS')return new Response(null,{headers:H});
    if(req.method==='GET'&&url.pathname==='/board'){
      const id=url.searchParams.get('level')||'';if(!level(id))return json({error:'unknown level'},400);
      const list=JSON.parse(await env.LB.get('lb:'+id)||'[]');
      return json({list:top(list,20),total:list.length});
    }
    if(req.method==='POST'&&url.pathname==='/submit'){
      const ip=req.headers.get('cf-connecting-ip')||'x',rk='rl:'+ip,n=+(await env.LB.get(rk)||0);
      if(n>=6)return json({error:'Too many submissions. Try again in a minute.'},429);
      await env.LB.put(rk,String(n+1),{expirationTtl:60});
      let b;try{b=await req.json();}catch(e){return json({error:'bad request'},400);}
      const id=String(b.level||''),L=level(id);if(!L)return json({error:'unknown level'},400);
      const name=String(b.name||'').trim().replace(/\s+/g,' ');
      if(!/^[\p{L}\p{N} _.'-]{1,24}$/u.test(name))return json({error:'Use 1 to 24 letters, numbers, spaces, or . _ \' -'},400);
      const lay=String(b.layout||'');
      if(!/^[0-9a-z]+$/.test(lay)||lay.length!==L.cells.length)return json({error:'That layout does not fit this level.'},400);
      const asg=[...lay].map(c=>parseInt(c,36));
      if(asg.some(g=>g>=L.S))return json({error:'That layout does not fit this level.'},400);
      const r=evaluate(L,asg);
      if(!r.complete||r.open||!isFinite(r.total))return json({error:'That is not a complete, connected pack.'},400);
      const score=Math.round(r.total*100)/100,key=name.toLowerCase();
      const list=JSON.parse(await env.LB.get('lb:'+id)||'[]'),prev=list.find(e=>e.name.toLowerCase()===key);
      let improved=false;
      if(!prev||score<prev.score){improved=true;
        const next=list.filter(e=>e.name.toLowerCase()!==key);next.push({name,score,layout:lay,t:Date.now()});
        next.sort((a,c)=>a.score-c.score||a.t-c.t);list.length=0;list.push(...next.slice(0,500));
        await env.LB.put('lb:'+id,JSON.stringify(list));}
      const rank=list.findIndex(e=>e.name.toLowerCase()===key)+1;
      return json({score,improved,best:list[rank-1].score,rank,total:list.length,list:top(list,20)});
    }
    return json({error:'not found'},404);
  }
};
