const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d', { alpha: false });
const moneyEl = document.getElementById('money');
const manpowerEl = document.getElementById('manpower');
const landEl = document.getElementById('land');
const toastEl = document.getElementById('toast');
const modeEl = document.getElementById('mode');

const W = 720, H = 360;
const CELL_COST_MONEY = 20;
const CELL_COST_MANPOWER = 35;
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
let destination = null;

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
  owner.fill(0); cities.length=0; ports.length=0; pushQueue=[]; pushing=false; destination=null;
  money=5000; manpower=7000; buildMode='push'; setModeText();
  const start=nearestLandFromLonLat(5.3,52.2); paintCircle(start.x,start.y,10,2);

  const starts=[[-98,39],[37,8],[118,35]];
  starts.forEach((p,i)=>{
    const s=nearestLandFromLonLat(p[0],p[1]); paintCircle(s.x,s.y,9,bots[i].id);
    bots[i].target=null; bots[i].cooldown=0;
    if(i===1) addPort(s.x,s.y,bots[i].id,true);
    if(i===0) addCity(s.x,s.y,bots[i].id,true);
  });
  refreshHUD(); draw();
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
function buildExpansionQueue(path,who=2,radius=5){
  const candidates=new Map();
  for(let k=1;k<path.length;k++){
    const p=path[k];
    for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++){
      const x=p.x+dx,y=p.y+dy;if(!isLand(x,y))continue;
      const d=Math.hypot(dx,dy);if(d>radius+0.35)continue;
      const i=idx(x,y);if(owner[i]===who||owner[i]===2&&who!==2)continue;
      // Don't include enemy pixels in a normal expansion wave.
      if(owner[i]!==0&&owner[i]!==1&&owner[i]!==who)continue;
      const score=k*0.001+d*0.08; const old=candidates.get(i); if(old===undefined||score<old.score)candidates.set(i,{x,y,score});
    }
  }
  return [...candidates.values()].sort((a,b)=>a.score-b.score);
}

function startPlayerPush(target){
  if(!isLand(target.x,target.y)||owner[idx(target.x,target.y)]===2)return;
  const start=findStartForPush(target.x,target.y,2);if(!start){toast('No starting territory found.');return;}
  const path=astar(start,target,2,true);if(!path.length){toast('No land route to that point.');return;}
  destination=target;
  const radius=Math.max(4,Math.min(8,Math.round(4.5/Math.max(zoom,.8))));
  pushQueue=buildExpansionQueue(path,2,radius);
  if(!pushQueue.length){toast('That point is already connected.');return;}
  if(!pushing){pushing=true;claimNextPlayer();}
}
function claimNextPlayer(){
  if(!pushQueue.length){pushing=false;draw();return;}
  if(money<CELL_COST_MONEY||manpower<CELL_COST_MANPOWER){pushing=false;toast('Not enough Money or Manpower.');return;}
  const p=pushQueue.shift(),i=idx(p.x,p.y);if(owner[i]!==0&&owner[i]!==1){claimNextPlayer();return;}
  money-=CELL_COST_MONEY;manpower-=CELL_COST_MANPOWER;owner[i]=2;
  refreshHUD();draw();setTimeout(claimNextPlayer,5);
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
  cities.push({x,y,owner:who,radius:5});return true;
}
function addPort(x,y,who=2,free=false){
  if(!objectCanBePlaced(x,y,who,'port'))return false;
  if(!free){if(who===2&&money<PLAYER_BUILD_PORT)return false;if(who===2)money-=PLAYER_BUILD_PORT;}
  ports.push({x,y,owner:who,radius:7});return true;
}
function placeObject(x,y,type){
  const ok=type==='city'?addCity(x,y,2,false):addPort(x,y,2,false);
  if(ok){setMode('push');refreshHUD();draw();toast(type==='city'?'City built.':'Port built.');}
  else toast(type==='city'?'City needs your land and space.':'Port must be on your land near the sea.');
}
function objectOwnerUpdate(){
  // Objects are captured if their center pixel is captured. Their circle remains visually independent of pixels.
  for(const o of [...cities,...ports]){
    const newOwner=owner[idx(Math.round(o.x),Math.round(o.y))];
    if(newOwner>=2&&newOwner!==o.owner){o.owner=newOwner;}
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

  // Objects are smooth circles and are not locked to a pixel shape.
  for(const c of cities){ctx.fillStyle=c.owner===2?color.city:ownerColor(c.owner);ctx.beginPath();ctx.arc(c.x+.5,c.y+.5,c.radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=.7;ctx.stroke();}
  for(const p of ports){ctx.fillStyle=p.owner===2?color.port:ownerColor(p.owner);ctx.beginPath();ctx.arc(p.x+.5,p.y+.5,p.radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=.8;ctx.stroke();}

  if(destination){ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=.7;ctx.beginPath();ctx.arc(destination.x+.5,destination.y+.5,3.5/Math.max(zoom,.7),0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={sx:e.clientX,sy:e.clientY,px:panX,py:panY,moved:false};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){panX=drag.px+dx;panY=drag.py+dy;draw();}});
canvas.addEventListener('pointerup',e=>{if(!drag)return;const click=!drag.moved;drag=null;if(!click)return;const p=screenToGrid(e.clientX,e.clientY);if(!isLand(p.x,p.y))return;if(buildMode==='push')startPlayerPush(p);else placeObject(p.x,p.y,buildMode);});
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
  const start=findStartForPush(target.x,target.y,bot.id);if(!start)return;
  const path=astar(start,{x:target.x,y:target.y},bot.id,true);if(!path.length)return;
  const rate=BOT_RATE;
  const radius=bot.type==='attacker'?4:bot.type==='economist'?3:3;
  const q=buildExpansionQueue(path,bot.id,radius);
  const maxCells=Math.max(3,Math.floor((bot.type==='attacker'?18:12)*rate));
  let spent=0;
  for(const p of q){
    if(spent>=maxCells)break;
    const i=idx(p.x,p.y);const o=owner[i];
    if(o===bot.id)continue;
    if(o>=2&&o!==bot.id){ if(bot.type==='attacker'){owner[i]=bot.id;bot.money-=CELL_COST_MONEY*rate;bot.manpower-=CELL_COST_MANPOWER*rate;spent++;} continue; }
    if(bot.money<CELL_COST_MONEY*rate||bot.manpower<CELL_COST_MANPOWER*rate)break;
    bot.money-=CELL_COST_MONEY*rate;bot.manpower-=CELL_COST_MANPOWER*rate;owner[i]=bot.id;spent++;
  }
}
function botBuild(bot){
  const c=countFor(bot.id);
  if(bot.type==='economist'&&bot.money>500&&c.port<3){
    const p=findBuildSpot(bot.id,'port');if(p){bot.money-=PLAYER_BUILD_PORT*BOT_RATE;ports.push({x:p.x,y:p.y,owner:bot.id,radius:7});}
  }
  if((bot.type==='economist'||bot.type==='attacker')&&bot.money>450&&c.city<4){
    const p=findBuildSpot(bot.id,'city');if(p){bot.money-=PLAYER_BUILD_CITY*BOT_RATE;cities.push({x:p.x,y:p.y,owner:bot.id,radius:5});}
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
