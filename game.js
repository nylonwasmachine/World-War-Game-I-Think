const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d', { alpha: false });
const moneyEl = document.getElementById('money');
const manpowerEl = document.getElementById('manpower');
const landEl = document.getElementById('land');
const toastEl = document.getElementById('toast');

// 720x360 logical pixels: tiny cells, but still smooth on normal screens.
const W = 720, H = 360;
const CELL_COST_MONEY = 20;
const CELL_COST_MANPOWER = 35;
const SAVE_KEY = 'pixel-world-conquest-v4';

let landMask = new Uint8Array(W * H);
let owner = new Int8Array(W * H); // 0 water, 1 neutral land, 2 player, 3 enemy
let cities = new Uint8Array(W * H);
let ports = new Uint8Array(W * H);
let queue = [];
let pushing = false;
let money = 5000;
let manpower = 7000;
let zoom = 1;
let panX = 0, panY = 0;
let drag = null;
let projection;
let landFeature;
let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

const color = {
  ocean: '#071522',
  land: '#162536',
  neutral: '#1d3144',
  player: '#36a8ff',
  playerEdge: '#7dd2ff',
  enemy: '#c34b5e',
  city: '#ffd166',
  port: '#73e0d0'
};

function idx(x, y) { return y * W + x; }
function inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
function isLand(x, y) { return inside(x,y) && landMask[idx(x,y)] === 1; }
function isPlayer(x, y) { return inside(x,y) && owner[idx(x,y)] === 2; }

function resize() {
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  draw();
}
window.addEventListener('resize', resize);

async function loadWorld() {
  const world = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
  landFeature = topojson.feature(world, world.objects.land);

  // Equirectangular keeps the pixel grid predictable and makes click-to-pixel reliable.
  projection = d3.geoEquirectangular().fitExtent([[0,0],[W,H]], landFeature);

  // Rasterize the real world coastline into the tiny pixel grid.
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W; maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  const path = d3.geoPath(projection, mctx);
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  path(landFeature);
  mctx.fill();
  const data = mctx.getImageData(0,0,W,H).data;
  for (let i=0; i<W*H; i++) landMask[i] = data[i*4] > 10 ? 1 : 0;

  resetState();
  resize();
}

function resetState() {
  owner.fill(0); cities.fill(0); ports.fill(0); queue = []; pushing = false;
  money = 5000; manpower = 7000;

  // Start in the Netherlands area; find the closest actual land pixel.
  const start = nearestLandFromLonLat(5.3, 52.2);
  paintCircle(start.x, start.y, 7, 2);

  // Small neutral AI territories for future battles.
  for (const p of [[-98,39],[37,8],[118,35]]) {
    const s = nearestLandFromLonLat(p[0], p[1]);
    paintCircle(s.x, s.y, 5, 3);
  }
  refreshHUD();
  draw();
}

function nearestLandFromLonLat(lon, lat) {
  const p = projection([lon, lat]);
  return nearestLand(Math.round(p[0]), Math.round(p[1]));
}

function nearestLand(x,y) {
  x = Math.max(0, Math.min(W-1,x)); y = Math.max(0, Math.min(H-1,y));
  if (isLand(x,y)) return {x,y};
  for (let r=1;r<40;r++) {
    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
      if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
      const nx=x+dx, ny=y+dy;
      if (isLand(nx,ny)) return {x:nx,y:ny};
    }
  }
  return {x,y};
}

function paintCircle(cx,cy,r,who) {
  for(let y=cy-r;y<=cy+r;y++) for(let x=cx-r;x<=cx+r;x++) {
    if (!isLand(x,y)) continue;
    const dx=x-cx, dy=y-cy;
    if (dx*dx+dy*dy <= r*r) owner[idx(x,y)] = who;
  }
}

function screenToGrid(sx,sy) {
  const rect = canvas.getBoundingClientRect();
  const x = (sx - rect.left - innerWidth/2 - panX) / zoom + W/2;
  const y = (sy - rect.top - innerHeight/2 - panY) / zoom + H/2;
  return {x:Math.floor(x),y:Math.floor(y)};
}

function gridToScreen(x,y) {
  return {
    x: innerWidth/2 + panX + (x-W/2)*zoom,
    y: innerHeight/2 + panY + (y-H/2)*zoom
  };
}

function neighbors(x,y) {
  return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
}

// A* across real land only. Diagonal steps make the frontier rounder instead of a square staircase.
function findStartForPush(targetX,targetY) {
  let best = null, bestD = Infinity;
  const radius = 90;
  for (let y=Math.max(0,targetY-radius); y<=Math.min(H-1,targetY+radius); y++) {
    for (let x=Math.max(0,targetX-radius); x<=Math.min(W-1,targetX+radius); x++) {
      if (!isPlayer(x,y)) continue;
      const d = Math.abs(x-targetX)+Math.abs(y-targetY);
      if (d < bestD) { bestD=d; best={x,y}; }
    }
  }
  if (best) return best;
  // Fallback: nearest player tile globally.
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(isPlayer(x,y)) {
    const d=Math.abs(x-targetX)+Math.abs(y-targetY);
    if(d<bestD){bestD=d;best={x,y};}
  }
  return best;
}

function astar(start,target) {
  const startI=idx(start.x,start.y), targetI=idx(target.x,target.y);
  const open=[];
  const came=new Int32Array(W*H); came.fill(-1);
  const g=new Float32Array(W*H); g.fill(Infinity);
  const f=new Float32Array(W*H); f.fill(Infinity);
  const closed=new Uint8Array(W*H);
  g[startI]=0; f[startI]=heur(start,target);
  open.push({x:start.x,y:start.y,f:f[startI]});

  while(open.length){
    // Small grid + binary heap isn't necessary here; choose lowest f.
    let bi=0;
    for(let i=1;i<open.length;i++) if(open[i].f<open[bi].f) bi=i;
    const cur=open.splice(bi,1)[0];
    const ci=idx(cur.x,cur.y);
    if(closed[ci]) continue;
    closed[ci]=1;
    if(ci===targetI){
      const path=[]; let p=ci;
      while(p!==-1){ path.push({x:p%W,y:Math.floor(p/W)}); if(p===startI) break; p=came[p]; }
      path.reverse(); return path;
    }
    for(const [dx,dy] of neighbors(cur.x,cur.y)){
      const nx=cur.x+dx, ny=cur.y+dy;
      if(!isLand(nx,ny)) continue;
      const ni=idx(nx,ny); if(closed[ni]) continue;
      const step=(dx&&dy)?1.414:1;
      // Enemy cells are traversable but never directly captured by this system.
      const ng=g[ci]+step;
      if(ng<g[ni]){
        came[ni]=ci; g[ni]=ng; f[ni]=ng+heur({x:nx,y:ny},target);
        open.push({x:nx,y:ny,f:f[ni]});
      }
    }
  }
  return [];
}
function heur(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

function startPush(target) {
  if (!isLand(target.x,target.y)) return;
  if (owner[idx(target.x,target.y)]===2) return;
  const start=findStartForPush(target.x,target.y);
  if(!start){ toast('No starting territory found.'); return; }
  const path=astar(start,target);
  if(!path.length){ toast('No land route to that pixel.'); return; }

  // Do not charge the starting owned pixels. Capture the path one tiny pixel at a time.
  queue = path.slice(1).filter(p => owner[idx(p.x,p.y)] !== 2);
  // If the path reaches an enemy, stop just before it for now.
  const enemyAt = queue.findIndex(p => owner[idx(p.x,p.y)]===3);
  if(enemyAt>=0) queue=queue.slice(0,enemyAt);
  if(!queue.length){ toast('That point is already connected.'); return; }
  if(!pushing) { pushing=true; claimNext(); }
}

function claimNext(){
  if(!queue.length){ pushing=false; refreshFront(); draw(); return; }
  if(money<CELL_COST_MONEY || manpower<CELL_COST_MANPOWER){
    pushing=false; toast('Not enough Money or Manpower.'); return;
  }
  const p=queue.shift();
  const i=idx(p.x,p.y);
  if(owner[i]===3){ pushing=false; toast('Enemy territory reached.'); return; }
  money-=CELL_COST_MONEY; manpower-=CELL_COST_MANPOWER; owner[i]=2;
  refreshHUD(); draw();
  setTimeout(claimNext, 8); // fast enough to feel smooth, still visibly pixel-by-pixel
}

function refreshFront(){ /* visual glow is calculated while drawing */ }

function counts(){
  let land=0, city=0, port=0;
  for(let i=0;i<W*H;i++) if(owner[i]===2){land++; if(cities[i])city++; if(ports[i])port++;}
  return {land,city,port};
}

function refreshHUD(){
  const c=counts();
  moneyEl.textContent=Math.floor(money).toLocaleString();
  manpowerEl.textContent=Math.floor(manpower).toLocaleString();
  landEl.textContent=c.land.toLocaleString();
}

function draw(){
  if(!projection) return;
  const scale=dpr;
  ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle=color.ocean; ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.save();
  ctx.translate(innerWidth/2+panX, innerHeight/2+panY);
  ctx.scale(zoom,zoom);
  ctx.translate(-W/2,-H/2);

  // World land base.
  ctx.fillStyle=color.land;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(landMask[idx(x,y)]) ctx.fillRect(x,y,1.05,1.05);

  // Tiny territory pixels. Neighbor smoothing means the frontier reads as a rounded shape.
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=idx(x,y), o=owner[i];
    if(o===0) continue;
    ctx.fillStyle=o===2?color.player:o===3?color.enemy:color.neutral;
    ctx.fillRect(x,y,1.08,1.08);
  }

  // Soft player frontier edge without hiding the tiny-pixel texture.
  ctx.fillStyle=color.playerEdge;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(owner[idx(x,y)]===2){
    let edge=false;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if(!isPlayer(x+dx,y+dy) && isLand(x+dx,y+dy)) {edge=true;break;}
    if(edge) ctx.globalAlpha=.5, ctx.fillRect(x,y,1,1), ctx.globalAlpha=1;
  }

  // Start/active destination markers.
  if(queue.length){ const p=queue[queue.length-1]; ctx.strokeStyle='rgba(255,255,255,.8)'; ctx.lineWidth=.8; ctx.beginPath(); ctx.arc(p.x+.5,p.y+.5,4/zoom,0,Math.PI*2); ctx.stroke(); }
  ctx.restore();
}

canvas.addEventListener('pointerdown', e=>{
  if(e.button!==0) return;
  drag={sx:e.clientX,sy:e.clientY,px:panX,py:panY,moved:false};
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e=>{
  if(!drag) return;
  const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
  if(Math.hypot(dx,dy)>5) drag.moved=true;
  if(drag.moved){panX=drag.px+dx;panY=drag.py+dy;draw();}
});
canvas.addEventListener('pointerup', e=>{
  if(!drag) return;
  const wasClick=!drag.moved; drag=null;
  if(wasClick){
    const p=screenToGrid(e.clientX,e.clientY);
    if(isLand(p.x,p.y)) startPush(p);
  }
});
canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  const before=screenToGrid(e.clientX,e.clientY);
  zoom=Math.max(.65,Math.min(7,zoom*Math.exp(-e.deltaY*.001)));
  const after=gridToScreen(before.x+.5,before.y+.5);
  panX+=e.clientX-after.x; panY+=e.clientY-after.y;
  draw();
},{passive:false});

document.getElementById('reset').onclick=()=>{ resetState(); toast('World reset.'); };
document.getElementById('save').onclick=()=>{
  localStorage.setItem(SAVE_KEY, JSON.stringify({owner:Array.from(owner),cities:Array.from(cities),ports:Array.from(ports),money,manpower}));
  toast('Game saved.');
};

function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>toastEl.classList.remove('show'),1600); }

// Passive economy.
setInterval(()=>{
  const c=counts();
  money += c.land*2 + c.port*8;
  manpower += c.land + c.city*7;
  refreshHUD();
},1000);

loadWorld().catch(err=>{console.error(err); toast('World map could not load. Check your internet connection.');});
