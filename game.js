const canvas=document.getElementById("map"),ctx=canvas.getContext("2d"),game=document.getElementById("game");
const moneyEl=document.getElementById("money"),mpEl=document.getElementById("manpower"),landEl=document.getElementById("land");
const citiesEl=document.getElementById("cities"),portsEl=document.getElementById("ports"),moneyRateEl=document.getElementById("moneyRate"),mpRateEl=document.getElementById("mpRate");
const frontierEl=document.getElementById("frontier"),cityBtn=document.getElementById("city"),portBtn=document.getElementById("port");
const W=180,H=90,SAVE="world_conquest_pixel_v2";
let money=500,manpower=1000,zoom=1,ox=0,oy=0,drag=false,moved=false,lastX=0,lastY=0,selected=null,claiming=false,claimQueue=[],claimTimer=0;
const tiles=new Map();
const K=(x,y)=>x+","+y;

function landShape(x,y){
  const lon=x/W*360-180,lat=90-y/H*180;
  const n=(lon+35)**2/155**2+(lat-12)**2/58**2<1;
  const a=(lon-115)**2/70**2+(lat-38)**2/35**2<1;
  const u=(lon+110)**2/45**2+(lat-32)**2/28**2<1;
  const s=(lon+60)**2/38**2+(lat+20)**2/27**2<1;
  const ant=(lon+65)**2/23**2+(lat+55)**2/16**2<1;
  return n||a||u||s||ant;
}
for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(landShape(x,y))tiles.set(K(x,y),{x,y,owner:"neutral",city:false,port:false});
const start={x:89,y:44};
tiles.get(K(start.x,start.y)).owner="player";
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const t=tiles.get(K(start.x+dx,start.y+dy));if(t)t.owner="player";}
for(const [x,y] of [[25,29],[146,25],[118,61]]){const t=tiles.get(K(x,y));if(t)t.owner="enemy";}

function neigh(t){return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>tiles.get(K(t.x+dx,t.y+dy))).filter(Boolean)}
function isFront(t){return t&&t.owner==="neutral"&&neigh(t).some(n=>n.owner==="player")}
function refreshFront(){for(const t of tiles.values())if(t.owner==="front")t.owner="neutral";for(const t of tiles.values())if(t.owner==="player")for(const n of neigh(t))if(n.owner==="neutral")n.owner="front"}

function save(){localStorage.setItem(SAVE,JSON.stringify({money,manpower,tiles:Object.fromEntries([...tiles].map(([k,v])=>[k,v]))}))}
function load(){const s=JSON.parse(localStorage.getItem(SAVE)||"null");if(!s)return;money=s.money??money;manpower=s.manpower??manpower;for(const[k,v]of Object.entries(s.tiles||{}))if(tiles.has(k))Object.assign(tiles.get(k),v)}
load();refreshFront();

function resize(){const d=devicePixelRatio||1;canvas.width=game.clientWidth*d;canvas.height=game.clientHeight*d;ctx.setTransform(d,0,0,d,0,0);draw()}addEventListener("resize",resize);
function screen(t){const cw=game.clientWidth/W*zoom,ch=game.clientHeight/H*zoom;return [t.x*cw+ox,t.y*ch+oy,cw,ch]}
function tileAt(px,py){const cw=game.clientWidth/W*zoom,ch=game.clientHeight/H*zoom;const x=Math.floor((px-ox)/cw),y=Math.floor((py-oy)/ch);return tiles.get(K(x,y))||null}

function draw(){
  const w=game.clientWidth,h=game.clientHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle="#80bfd1";ctx.fillRect(0,0,w,h);
  for(const t of tiles.values()){
    const [x,y,cw,ch]=screen(t);let c="#718093";
    if(t.owner==="player")c="#45d884";if(t.owner==="enemy")c="#db5a61";if(t.owner==="front")c="#e2c34f";
    ctx.fillStyle=c;ctx.fillRect(Math.floor(x),Math.floor(y),Math.ceil(cw)+.2,Math.ceil(ch)+.2);
    ctx.strokeStyle="rgba(20,45,55,.18)";ctx.strokeRect(Math.floor(x),Math.floor(y),Math.ceil(cw),Math.ceil(ch));
    if(t.city){ctx.fillStyle="#fff";ctx.fillRect(x+cw*.3,y+ch*.25,cw*.4,ch*.5);ctx.fillStyle="#26303a";ctx.fillRect(x+cw*.44,y+ch*.39,cw*.12,ch*.15)}
    if(t.port){ctx.fillStyle="#245c85";ctx.fillRect(x+cw*.15,y+ch*.7,cw*.7,ch*.13)}
    if(t===selected){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,cw-2,ch-2)}
  }
  const [sx,sy,cw,ch]=screen(tiles.get(K(start.x,start.y)));
  ctx.beginPath();ctx.arc(sx+cw/2,sy+ch/2,Math.max(8,12*zoom),0,Math.PI*2);ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.stroke();
}

function update(){
  let land=0,cities=0,ports=0;for(const t of tiles.values())if(t.owner==="player"){land++;cities+=t.city?1:0;ports+=t.port?1:0}
  const mr=land*2+ports*8,pr=land+cities*7;
  moneyEl.textContent=Math.floor(money);mpEl.textContent=Math.floor(manpower);landEl.textContent=land;citiesEl.textContent=cities;portsEl.textContent=ports;
  moneyRateEl.textContent="+"+mr+"/s";mpRateEl.textContent="+"+pr+"/s";
  cityBtn.disabled=!selected||selected.owner!=="player"||selected.city||money<80;
  portBtn.disabled=!selected||selected.owner!=="player"||selected.port||money<120;
}
function nearestOwned(t){
  let best=null,dist=1e9;
  for(const p of tiles.values())if(p.owner==="player"){const d=Math.abs(p.x-t.x)+Math.abs(p.y-t.y);if(d<dist){dist=d;best=p}}
  return best;
}
function makePath(startTile,target){
  // Manhattan path: moves horizontally/vertically, one pixel at a time.
  let x=startTile.x,y=startTile.y,goalX=target.x,goalY=target.y,path=[];
  while(x!==goalX||y!==goalY){
    if(x!==goalX)x+=Math.sign(goalX-x);else y+=Math.sign(goalY-y);
    const t=tiles.get(K(x,y));if(t)path.push(t);else break;
  }
  return path;
}
function beginPush(target){
  if(claiming||target.owner==="player"||target.owner==="enemy")return;
  const origin=nearestOwned(target);if(!origin)return;
  claimQueue=makePath(origin,target);
  // A path may cross ocean in this prototype; stop at the first non-land gap.
  claimQueue=claimQueue.filter(t=>t);
  if(!claimQueue.length)return;
  claiming=true;frontierEl.textContent="Pushing the frontier…";claimTimer=0;
}
function claimStep(){
  if(!claiming)return;
  if(money<20||manpower<35||!claimQueue.length){
    claiming=false;frontierEl.textContent=claimQueue.length?"Not enough resources to keep pushing.":"Frontier reached.";
    refreshFront();save();update();draw();return;
  }
  const t=claimQueue.shift();
  if(t.owner==="enemy"){claiming=false;frontierEl.textContent="Enemy territory reached. War system coming next.";return}
  money-=20;manpower-=35;t.owner="player";
  refreshFront();update();draw();
  if(!claimQueue.length){claiming=false;frontierEl.textContent="Frontier reached.";save()}
  else claimTimer=setTimeout(claimStep,35);
}

canvas.addEventListener("pointerdown",e=>{drag=true;moved=false;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;ox+=dx;oy+=dy;lastX=e.clientX;lastY=e.clientY;draw()});
canvas.addEventListener("pointerup",e=>{drag=false;if(moved)return;const t=tileAt(e.offsetX,e.offsetY);selected=t||null;if(t&&t.owner!=="player")beginPush(t);update();draw()});
canvas.addEventListener("wheel",e=>{e.preventDefault();const old=zoom;zoom=Math.max(.7,Math.min(7,zoom*(e.deltaY<0?1.15:.87)));const rx=e.offsetX-ox,ry=e.offsetY-oy;ox=e.offsetX-rx*zoom/old;oy=e.offsetY-ry*zoom/old;draw()},{passive:false});

cityBtn.onclick=()=>{if(selected&&selected.owner==="player"&&!selected.city&&money>=80){money-=80;selected.city=true;save();update();draw()}};
portBtn.onclick=()=>{if(selected&&selected.owner==="player"&&!selected.port&&money>=120){money-=120;selected.port=true;save();update();draw()}};
document.getElementById("save").onclick=()=>{save();document.getElementById("save").textContent="SAVED";setTimeout(()=>document.getElementById("save").textContent="SAVE GAME",900)};
document.getElementById("reset").onclick=()=>{if(confirm("Reset the world?")){localStorage.removeItem(SAVE);location.reload()}};

setInterval(()=>{
  let land=0,cities=0,ports=0;for(const t of tiles.values())if(t.owner==="player"){land++;cities+=t.city?1:0;ports+=t.port?1:0}
  money+=land*2+ports*8;manpower+=land+cities*7;
  // Small enemy expansion to make the world feel alive.
  if(Math.random()<.12){const f=[...tiles.values()].filter(t=>t.owner==="enemy").flatMap(t=>neigh(t).filter(n=>n.owner==="neutral"));if(f.length)f[Math.floor(Math.random()*f.length)].owner="enemy"}
  refreshFront();update();draw();
},1000);

resize();update();draw();
