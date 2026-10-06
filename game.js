const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d', { alpha: false });
const moneyEl = document.getElementById('money');
const manpowerEl = document.getElementById('manpower');
const landEl = document.getElementById('land');
const toastEl = document.getElementById('toast');
const modeEl = document.getElementById('mode');

const W = 720, H = 360;
const CELL_COST_MONEY = 20;
const CELL_COST_MANPOWER = 18;
const LAND_COMBAT_COST = 12;
const BOT_COMBAT_COST = 10;
const ATTACK_WAVE = 95;
const BOT_RATE = 0.8;
const PLAYER_BUILD_CITY = 80;
const PLAYER_BUILD_PORT = 120;
const CITY_MANPOWER = 7;
const PORT_MONEY = 8;
const SAVE_KEY = 'pixel-world-conquest-v6';

let landMask = new Uint8Array(W * H);
let owner = new Int8Array(W * H); // 0 water, 1 neutral, 2 player, 3 attacker, 4 economist, 5 ranged
let pushing = false;
let pushQueue = [];
let money = 5000, manpower = 7000;
let zoom = 1, panX = 0, panY = 0, drag = null;
let projection, landFeature;
let dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
let buildMode = 'push';
let nextBotThink = 0;
let destinations = [];
let attackJobs = [];
let nextAttackId = 1;
let choosingStart = true;
let gameStarted = false;

// Cities and ports are world objects, not single pixels. Their circles sit on top of land.
const cities = [];
const ports = [];
const bots = [
  { id: 3, name: 'Attacker', type: 'attacker', money: 4200, manpower: 6200, target: null, cooldown: 0 },
  { id: 4, name: 'Economist', type: 'economist', money: 6200, manpower: 5200, target: null, cooldown: 0 },
  { id: 5, name: 'Ranged', type: 'ranged', money: 5000, manpower: 5400, target: null, cooldown: 0 }
];

const color = {
  ocean: '#071522', land: '#162536', neutral: '#1d3144', player: '#36a8ff',
  attacker: '#e85b6d', economist: '#62d38a', ranged: '#b887ff', edge: '#bfe9ff',
  city: '#ffd166', port: '#73e0d0'
};

function idx(x,y){return y*W+x;}
function inside(x,y){return x>=0&&y>=0&&x<W&&y<H;}
function isLand(x,y){return inside(x,y)&&landMask[idx(x,y)]===1;}
function getOwner(x,y){return inside(x,y)?owner[idx(x,y)]:0;}
function ownerColor(o){return o===2?color.player:o===3?color.attacker:o===4?color.economist:o===5?color.ranged:color.neutral;}
function neighbors(x,y){return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];}

function resize(){
  dpr=Math.max(1,Math.min(2,devicePixelRatio||1));
  canvas.width=Math.floor(innerWidth*dpr); canvas.height=Math.floor(innerHeight*dpr);
  canvas.style.width=innerWidth+'px'; canvas.style.height=innerHeight+'px'; draw();
}
window.addEventListener('resize',resize);

async function loadWorld(){
  const world=await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r=>r.json());
  landFeature=topojson.feature(world,world.objects.land);
  projection=d3.geoEquirectangular().fitExtent([[0,0],[W,H]],landFeature);
  const mc=document.createElement('canvas'); mc.width=W; mc.height=H;
  const mctx=mc.getContext('2d'); const path=d3.geoPath(projection,mctx);
  mctx.fillStyle='#fff'; mctx.beginPath(); path(landFeature); mctx.fill();
  const data=mctx.getImageData(0,0,W,H).data;
  for(let i=0;i<W*H;i++) landMask[i]=data[i*4]>10?1:0;
  resetState(); resize();
}

function resetState(){
  owner.fill(0); cities.length=0; ports.length=0; pushQueue=[]; attackJobs=[]; destinations=[]; pushing=false;
  money=5000; manpower=7000; buildMode='push'; setModeText(); choosingStart=true; gameStarted=false;
  bots.forEach(b=>{b.target=null;b.cooldown=0;b.money=b.type==='economist'?6200:b.type==='attacker'?4200:5000;b.manpower=b.type==='attacker'?6200:b.type==='economist'?5200:5400;});
  showStartOverlay(true); refreshHUD(); draw();
}

function randomBotSpawn(existing){
  for(let tries=0;tries<5000;tries++){
    const x=Math.floor(Math.random()*W),y=Math.floor(Math.random()*H);
    if(!isLand(x,y))continue;
    if(existing.some(s=>Math.hypot(s.x-x,s.y-y)<55))continue;
    if(existing.some(s=>owner[idx(x,y)]===s.id))continue;
    return {x,y};
  }
  return nearestLand(Math.floor(Math.random()*W),Math.floor(Math.random()*H));
}
function startGameAt(x,y){
  const start=nearestLand(x,y); paintCircle(start.x,start.y,10,2);
  const starts=[{x:start.x,y:start.y,id:2}];
  bots.forEach((bot,i)=>{
    const s=randomBotSpawn(starts); paintCircle(s.x,s.y,9,bot.id); starts.push({x:s.x,y:s.y,id:bot.id});
    bot.target=null; bot.cooldown=700+i*900;
  });
  choosingStart=false; gameStarted=true; showStartOverlay(false); toast('Your country has spawned. Choose a point to expand.'); refreshHUD(); draw();
}

function nearestLandFromLonLat(lon,lat){const p=projection([lon,lat]);return nearestLand(Math.round(p[0]),Math.round(p[1]));}
function nearestLand(x,y){
  x=Math.max(0,Math.min(W-1,x)); y=Math.max(0,Math.min(H-1,y));
  if(isLand(x,y)) return {x,y};
  for(let r=1;r<60;r++) for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    if(Math.abs(dx)!==r&&Math.abs(dy)!==r) continue;
    if(isLand(x+dx,y+dy)) return {x:x+dx,y:y+dy};
  }
  return {x,y};
}
function paintCircle(cx,cy,r,who){
  for(let y=cy-r;y<=cy+r;y++) for(let x=cx-r;x<=cx+r;x++) if(isLand(x,y)){
    const dx=x-cx,dy=y-cy;if(dx*dx+dy*dy<=r*r) owner[idx(x,y)]=who;
  }
}

function screenToGrid(sx,sy){
  const rect=canvas.getBoundingClientRect();
  return {x:Math.floor((sx-rect.left-innerWidth/2-panX)/zoom+W/2),y:Math.floor((sy-rect.top-innerHeight/2-panY)/zoom+H/2)};
}
function gridToScreen(x,y){return {x:innerWidth/2+panX+(x-W/2)*zoom,y:innerHeight/2+panY+(y-H/2)*zoom};}

function findStartForPush(targetX,targetY,who=2){
  let best=null,bestD=Infinity;
  for(let y=Math.max(0,targetY-110);y<=Math.min(H-1,targetY+110);y++) for(let x=Math.max(0,targetX-110);x<=Math.min(W-1,targetX+110);x++){
    if(owner[idx(x,y)]!==who) continue;
    const d=Math.hypot(x-targetX,y-targetY); if(d<bestD){bestD=d;best={x,y};}
  }
  if(best)return best;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(owner[idx(x,y)]===who){const d=Math.hypot(x-targetX,y-targetY);if(d<bestD){bestD=d;best={x,y};}}
  return best;
}

function astar(start,target,who,allowEnemy=true){
  const N=W*H, s=idx(start.x,start.y), t=idx(target.x,target.y);
  const came=new Int32Array(N); came.fill(-1); const g=new Float32Array(N); g.fill(Infinity); const f=new Float32Array(N); f.fill(Infinity); const closed=new Uint8Array(N);
  const open=[{x:start.x,y:start.y,f:0}]; g[s]=0; f[s]=heur(start,target);
  while(open.length){
    let bi=0;for(let i=1;i<open.length;i++)if(open[i].f<open[bi].f)bi=i;
    const cur=open.splice(bi,1)[0],ci=idx(cur.x,cur.y);if(closed[ci])continue;closed[ci]=1;
    if(ci===t){const path=[];let p=ci;while(p!==-1){path.push({x:p%W,y:Math.floor(p/W)});if(p===s)break;p=came[p];}path.reverse();return path;}
    for(const [dx,dy] of neighbors(cur.x,cur.y)){
      const nx=cur.x+dx,ny=cur.y+dy;if(!isLand(nx,ny))continue;const ni=idx(nx,ny);if(closed[ni])continue;
      const o=owner[ni]; if(!allowEnemy&&o!==0&&o!==1&&o!==who)continue;
      const step=dx&&dy?1.414:1; let cost=step;
      if(o!==0&&o!==1&&o!==who) cost+=8; // bots prefer neutral land, but can approach other bot/player land
      const ng=g[ci]+cost;if(ng<g[ni]){came[ni]=ci;g[ni]=ng;f[ni]=ng+heur({x:nx,y:ny},target);open.push({x:nx,y:ny,f:f[ni]});}
    }
  }
  return [];
}
function heur(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

// Builds a broad, rounded corridor rather than a 1-pixel line.
function buildExpansionQueue(path,who=2,radius=9){
  const candidates=new Map();
  // Build a broad moving half-circle: each path slice contributes a rounded fan,
  // and the outer arc is queued first so the front advances as a wide wave.
  for(let k=1;k<path.length;k++){
    const p=path[k];
    for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++){
      const x=p.x+dx,y=p.y+dy;if(!isLand(x,y))continue;
      const d=Math.hypot(dx,dy);if(d>radius)continue;
      const i=idx(x,y);const o=owner[i];
      if(o===who || (o!==0&&o!==1&&o!==who))continue;
      const progress=k/path.length;
      // Slightly flatten the back side and keep the active front rounded.
      const arcBias=(dy*dy)/(radius*radius);
      const score=k*0.012 + (radius-d)*0.018 + arcBias*0.025;
      const old=candidates.get(i); if(old===undefined||score<old.score)candidates.set(i,{x,y,score,progress});
    }
  }
  return [...candidates.values()].sort((a,b)=>a.progress-b.progress || a.score-b.score);
}

function makeAttackJob(target, who=2){
  const start=findStartForPush(target.x,target.y,who);
  if(!start)return null;
  const path=astar(start,target,who,true);
  if(!path.length)return null;
  const radius=who===2?10:8;
  const cells=buildExpansionQueue(path,who,radius);
  if(!cells.length)return null;
  return {id:nextAttackId++,who,target,path,cells,cursor:0,committed:0,loss:0,active:true,created:performance.now()};
}
function startPlayerPush(target){
  if(!gameStarted || choosingStart)return;
  if(!isLand(target.x,target.y))return;
  if(owner[idx(target.x,target.y)]===2)return;
  const job=makeAttackJob(target,2);
  if(!job){toast('No land route to that point.');return;}
  // Multiple attack points are allowed. A click adds another front instead of replacing the first one.
  destinations.push(target); attackJobs.push(job); pushing=true;
  toast('Attack point added.');
  draw();
}
function terrainCost(x,y){
  let edge=0;
  for(const [dx,dy] of neighbors(x,y)) if(isLand(x+dx,y+dy)&&owner[idx(x+dx,y+dy)]!==owner[idx(x,y)]) edge++;
  return LAND_COMBAT_COST + Math.min(8,edge);
}
function enemyTroopsAt(x,y,defender){
  if(defender<3)return 0;
  const b=bots.find(b=>b.id===defender); return b ? Math.max(12,Math.floor(b.manpower*0.015)) : 0;
}
function battlePixel(job,p){
  const i=idx(p.x,p.y), o=owner[i];
  if(o===job.who)return true;
  const attackerTroops=Math.max(0,Math.floor(job.committed));
  if(attackerTroops<=0)return false;
  // Only the outer border can be taken. A pixel must touch the attacker's territory.
  let frontier=false;
  for(const [dx,dy] of neighbors(p.x,p.y)) if(isLand(p.x+dx,p.y+dy)&&owner[idx(p.x+dx,p.y+dy)]===job.who){frontier=true;break;}
  if(!frontier)return false;
  const enemy=enemyTroopsAt(p.x,p.y,o);
  const areaPenalty=terrainCost(p.x,p.y);
  const required=areaPenalty+enemy;
  const spend=Math.min(attackerTroops, Math.max(areaPenalty, Math.ceil(required*.28)));
  job.committed=Math.max(0,job.committed-spend); job.loss+=spend;
  if(o===0||o===1){
    if(attackerTroops>=areaPenalty){owner[i]=job.who;return true;}
    return false;
  }
  if(o!==job.who){
    const defender=bots.find(b=>b.id===o);
    const attackPower=attackerTroops-areaPenalty;
    const defendPower=enemy;
    if(attackPower>defendPower){
      if(defender) defender.manpower=Math.max(0,defender.manpower-Math.max(1,Math.floor((attackPower-defendPower)*.55)));
      owner[i]=job.who; return true;
    }
    if(defender) defender.manpower=Math.max(0,defender.manpower-Math.max(1,Math.floor(attackPower*.35)));
    return false;
  }
  return false;
}

function refillJob(job){
  if(job.who!==2)return;
  const available=Math.floor(manpower);
  if(available<=0)return;
  const take=Math.min(ATTACK_WAVE,available);
  manpower-=take; job.committed+=take;
}
function advanceAttackJobs(){
  let active=0;
  for(const job of attackJobs){
    if(!job.active)continue;
    if(job.who===2) refillJob(job);
    if(job.committed<=0 && (job.who!==2 || manpower<=0)){ job.active=false; continue; }
    const steps=job.who===2?5:4;
    for(let s=0;s<steps;s++){
      if(job.cursor>=job.cells.length)break;
      const p=job.cells[job.cursor++];
      const captured=battlePixel(job,p);
      if(!captured && job.who!==2){
        job.cursor=Math.max(0,job.cursor-1);
        if(job.committed<=0){ job.active=false; break; }
        break;
      }
    }
    if(job.cursor>=job.cells.length){
      job.active=false; job.committed=Math.floor(job.committed*.72);
    } else active++;
  }
  attackJobs=attackJobs.filter(j=>j.active || j.committed>0);
  pushing=active>0;
  refreshHUD(); draw();
}

function countFor(who){
  let land=0;for(let i=0;i<W*H;i++)if(owner[i]===who)land++;
  return {land,city:cities.filter(o=>o.owner===who).length,port:ports.filter(o=>o.owner===who).length};
}
function refreshHUD(){const c=countFor(2);moneyEl.textContent=Math.floor(money).toLocaleString();manpowerEl.textContent=Math.floor(manpower).toLocaleString();landEl.textContent=c.land.toLocaleString();}

function isNearSea(x,y,r=7){
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(inside(x+dx,y+dy)&&!isLand(x+dx,y+dy))return true;
  return false;
}
function objectCanBePlaced(x,y,who,type){
  if(!isLand(x,y)||owner[idx(x,y)]!==who)return false;
  if(type==='port'&&!isNearSea(x,y,9))return false;
  const list=type==='port'?ports:cities;
  return !list.some(o=>Math.hypot(o.x-x,o.y-y)<12);
}
function addCity(x,y,who=2,free=false){
  if(!objectCanBePlaced(x,y,who,'city'))return false;
  if(!free){if(who===2&&money<PLAYER_BUILD_CITY)return false;if(who===2)money-=PLAYER_BUILD_CITY;}
  cities.push({x,y,owner:who,radius:3.4});return true;
}
function addPort(x,y,who=2,free=false){
  if(!objectCanBePlaced(x,y,who,'port'))return false;
  if(!free){if(who===2&&money<PLAYER_BUILD_PORT)return false;if(who===2)money-=PLAYER_BUILD_PORT;}
  ports.push({x,y,owner:who,radius:3.8});return true;
}
function placeObject(x,y,type){
  const ok=type==='city'?addCity(x,y,2,false):addPort(x,y,2,false);
  if(ok){setMode('push');refreshHUD();draw();toast(type==='city'?'City built.':'Port built.');}
  else toast(type==='city'?'City needs your land and space.':'Port must be on your land near the sea.');
}
function objectOwnerUpdate(){
  for(const o of [...cities,...ports]){
    const newOwner=owner[idx(Math.round(o.x),Math.round(o.y))];
    if(newOwner>=2&&newOwner!==o.owner)o.owner=newOwner;
  }
}

function setMode(m){buildMode=m;setModeText();}
function setModeText(){if(modeEl)modeEl.textContent=buildMode==='push'?'Push':buildMode==='city'?'Build City':'Build Port';}
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>toastEl.classList.remove('show'),1700);}

function draw(){
  if(!projection)return; objectOwnerUpdate();
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=color.ocean;ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.save();ctx.translate(innerWidth/2+panX,innerHeight/2+panY);ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);

  ctx.fillStyle=color.land;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(landMask[idx(x,y)])ctx.fillRect(x,y,1.04,1.04);

  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const o=owner[idx(x,y)];if(o>=2){ctx.fillStyle=ownerColor(o);ctx.fillRect(x,y,1.04,1.04);}else if(o===1){ctx.fillStyle=color.neutral;ctx.fillRect(x,y,1.04,1.04);}}

  // Very subtle frontier glow, without making the individual pixels visible.
  ctx.globalAlpha=.45;ctx.fillStyle=color.edge;
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(owner[idx(x,y)]===2){let edge=false;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(isLand(x+dx,y+dy)&&owner[idx(x+dx,y+dy)]!==2){edge=true;break;}if(edge)ctx.fillRect(x,y,1.05,1.05);}
  ctx.globalAlpha=1;

  // Small smooth strategic circles. Icons stay readable without making the circles large.
  for(const c of cities){
    const r=c.radius; ctx.fillStyle=c.owner===2?color.city:ownerColor(c.owner);ctx.beginPath();ctx.arc(c.x+.5,c.y+.5,r,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff4c2';ctx.beginPath();ctx.moveTo(c.x-.1,c.y-2.4);ctx.lineTo(c.x+2.5,c.y);ctx.lineTo(c.x+.1,c.y+2.6);ctx.lineTo(c.x-2.5,c.y);ctx.closePath();ctx.fill();
    ctx.fillStyle='#8b5a2b';ctx.fillRect(c.x-1.6,c.y+.1,3.2,2.7);
  }
  for(const p of ports){
    const r=p.radius; ctx.fillStyle=p.owner===2?color.port:ownerColor(p.owner);ctx.beginPath();ctx.arc(p.x+.5,p.y+.5,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=.55;ctx.stroke();
    // Tiny ship silhouette.
    ctx.fillStyle='#eaffff';ctx.beginPath();ctx.moveTo(p.x-3,p.y+1.8);ctx.lineTo(p.x+3.2,p.y+1.8);ctx.lineTo(p.x+1.7,p.y+3.2);ctx.lineTo(p.x-2,p.y+3.2);ctx.closePath();ctx.fill();
    ctx.fillRect(p.x-.45,p.y-2.8,.8,4.5);ctx.beginPath();ctx.moveTo(p.x+.35,p.y-2.7);ctx.lineTo(p.x+3,p.y+.3);ctx.lineTo(p.x+.35,p.y+.3);ctx.closePath();ctx.fill();
  }

  // Attack points and troop movement counters.
  for(const job of attackJobs){
    if(!job.active)continue; const q=gridToScreen(job.target.x+.5,job.target.y+.5);
    const moving=Math.floor(job.committed); const enemy=enemyTroopsAt(job.target.x,job.target.y,owner[idx(job.target.x,job.target.y)]);
    ctx.strokeStyle=job.who===2?'rgba(255,255,255,.7)':'rgba(255,120,120,.7)';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(job.target.x+.5,job.target.y+.5,4.5/Math.max(zoom,.7),0,Math.PI*2);ctx.stroke();
    ctx.save();ctx.font='700 '+(9/Math.max(zoom,.7))+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(moving.toLocaleString()+' ⚔ '+enemy.toLocaleString(),job.target.x+.5,job.target.y-7/Math.max(zoom,.7));ctx.restore();
  }
  if(choosingStart){
    ctx.save(); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='rgba(3,10,18,.72)'; ctx.fillRect(0,0,innerWidth,innerHeight);
    ctx.fillStyle='#fff'; ctx.font='800 24px system-ui'; ctx.textAlign='center'; ctx.fillText('CHOOSE YOUR STARTING LAND',innerWidth/2,innerHeight/2-18);
    ctx.font='500 14px system-ui'; ctx.fillStyle='rgba(255,255,255,.8)'; ctx.fillText('Click any land area to spawn your country',innerWidth/2,innerHeight/2+12);
    ctx.restore();
  }
  ctx.restore();
}

canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={sx:e.clientX,sy:e.clientY,px:panX,py:panY,moved:false};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){panX=drag.px+dx;panY=drag.py+dy;draw();}});
canvas.addEventListener('pointerup',e=>{if(!drag)return;const click=!drag.moved;drag=null;if(!click)return;const p=screenToGrid(e.clientX,e.clientY);if(!isLand(p.x,p.y))return;if(choosingStart){startGameAt(p.x,p.y);return;}if(buildMode==='push')startPlayerPush(p);else placeObject(p.x,p.y,buildMode);});
canvas.addEventListener('wheel',e=>{e.preventDefault();const before=screenToGrid(e.clientX,e.clientY);zoom=Math.max(.65,Math.min(12,zoom*Math.exp(-e.deltaY*.001)));const after=gridToScreen(before.x+.5,before.y+.5);panX+=e.clientX-after.x;panY+=e.clientY-after.y;draw();},{passive:false});

document.getElementById('save').onclick=()=>{localStorage.setItem(SAVE_KEY,JSON.stringify({owner:Array.from(owner),cities,ports,money,manpower}));toast('Game saved.');};
document.getElementById('reset').onclick=()=>{resetState();toast('World reset.');};
document.getElementById('pushMode').onclick=()=>setMode('push');
document.getElementById('cityMode').onclick=()=>setMode('city');
document.getElementById('portMode').onclick=()=>setMode('port');

function nearestTargetLand(who){
  let best=null,bestD=Infinity;
  for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){const o=owner[idx(x,y)];if(o!==0&&o!==1&&o!==who)continue; if(o===who)continue;const dToOwn=nearestOwnedDistance(x,y,who);if(dToOwn<bestD){bestD=dToOwn;best={x,y};}}
  return best;
}
function nearestOwnedDistance(x,y,who){let best=Infinity;for(let yy=Math.max(0,y-45);yy<=Math.min(H-1,y+45);yy+=2)for(let xx=Math.max(0,x-45);xx<=Math.min(W-1,x+45);xx+=2)if(owner[idx(xx,yy)]===who){best=Math.min(best,Math.hypot(xx-x,yy-y));}return best;}

function botChooseTarget(bot){
  // Bots naturally prioritize the closest neutral/player/bot land, so they can collide with one another.
  let candidates=[];
  for(let y=0;y<H;y+=3)for(let x=0;x<W;x+=3){
    const o=owner[idx(x,y)];if(o===0||o===bot.id)continue;
    const d=nearestOwnedDistance(x,y,bot.id);if(!isFinite(d)||d>140)continue;
    candidates.push({x,y,d,enemy:o});
  }
  candidates.sort((a,b)=>a.d-b.d);
  if(bot.type==='attacker'){
    const enemy=candidates.find(c=>c.enemy===2||c.enemy>=3);return enemy||candidates[0];
  }
  if(bot.type==='economist'){
    const neutral=candidates.find(c=>c.enemy===1);return neutral||candidates[0];
  }
  const player=candidates.find(c=>c.enemy===2);return player||candidates[0];
}

function botExpand(bot){
  const target=botChooseTarget(bot);if(!target)return;
  const job=makeAttackJob(target,bot.id);if(!job)return;
  job.committed=Math.max(80,Math.floor(bot.manpower*.035*BOT_RATE));
  bot.manpower=Math.max(0,bot.manpower-job.committed);
  attackJobs.push(job);
}

function botBuild(bot){
  const c=countFor(bot.id);
  if(bot.type==='economist'&&bot.money>500&&c.port<3){
    const p=findBuildSpot(bot.id,'port');if(p){bot.money-=PLAYER_BUILD_PORT*BOT_RATE;ports.push({x:p.x,y:p.y,owner:bot.id,radius:3.8});}
  }
  if((bot.type==='economist'||bot.type==='attacker')&&bot.money>450&&c.city<4){
    const p=findBuildSpot(bot.id,'city');if(p){bot.money-=PLAYER_BUILD_CITY*BOT_RATE;cities.push({x:p.x,y:p.y,owner:bot.id,radius:3.4});}
  }
}
function findBuildSpot(who,type){
  for(let n=0;n<350;n++){
    const x=Math.floor(Math.random()*W),y=Math.floor(Math.random()*H);if(objectCanBePlaced(x,y,who,type))return {x,y};
  }return null;
}
function runBots(){
  for(const bot of bots){
    const c=countFor(bot.id);
    bot.money+=(c.land*2+c.port*PORT_MONEY)*BOT_RATE;
    bot.manpower+=(c.land+c.city*CITY_MANPOWER)*BOT_RATE;
    bot.cooldown-=1000;
    botBuild(bot);
    if(bot.cooldown<=0){botExpand(bot);bot.cooldown=1800/BOT_RATE;}
  }
  refreshHUD();draw();
}
setInterval(()=>{ advanceAttackJobs(); },140);
setInterval(runBots,1000);

// Player economy.
setInterval(()=>{
  const c=countFor(2);money+=c.land*2+c.port*PORT_MONEY;manpower+=c.land+c.city*CITY_MANPOWER;refreshHUD();
},1000);

window.addEventListener('keydown',e=>{
  if(e.key.toLowerCase()==='c')setMode('city');
  if(e.key.toLowerCase()==='p')setMode('port');
  if(e.key==='Escape')setMode('push');
});

loadWorld().catch(err=>{console.error(err);toast('World map could not load. Check your internet connection.');});
