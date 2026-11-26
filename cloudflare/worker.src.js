// Spotweld leaderboard. Re-scores every submitted layout with the game's own solver
// (inlined below from spotweld/index.html by build.py), so only the layout is trusted, never a score.
/*CORE*/
const CACHE={};
const level=id=>{if(!CACHE[id]){const d=DEMOS.find(x=>x.id===id);if(!d)return null;CACHE[id]=prepLevel(JSON.parse(JSON.stringify(d)));}return CACHE[id];};
const H={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','content-type':'application/json'};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:H});
const top=(list,n)=>list.slice(0,n).map(e=>({name:e.name,score:e.score,layout:e.layout}));

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
      if(list.some(e=>e.layout===lay))return json({error:'That exact layout is already on the board.'},409);
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
