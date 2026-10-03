const canvas=document.getElementById("map"),ctx=canvas.getContext("2d"),game=document.getElementById("game");
const moneyEl=document.getElementById("money"),mpEl=document.getElementById("manpower"),landEl=document.getElementById("land");
const citiesEl=document.getElementById("cities"),portsEl=document.getElementById("ports");
const landMoneyEl=document.getElementById("landMoney"),portMoneyEl=document.getElementById("portMoney"),moneyRateEl=document.getElementById("moneyRate");
const landMPEl=document.getElementById("landMP"),cityMPEl=document.getElementById("cityMP"),mpRateEl=document.getElementById("mpRate");
const selectionEl=document.getElementById("selection"),claimBtn=document.getElementById("claim"),cityBtn=document.getElementById("city"),portBtn=document.getElementById("port");

const SAVE_KEY="world_conquest_push_v1";
const COLS=96, ROWS=48;
let money=250,manpower=500,selected=null,drag=false,lastX=0,lastY=0,moved=false,zoom=1,ox=0,oy=0;
const PLAYER="#43d17b", ENEMY="#df5b61", NEUTRAL="#667487";

function key(x,y){return x+","+y}
let tiles=new Map();

function worldShape(x,y){
  // Stylized complete-world silhouette: oceans remain blue and the landmass is divided into claimable tiles.
  const lon=(x/COLS)*360-180, lat=90-(y/ROWS)*180;
  const a=Math.pow((lon+35)/155,2)+Math.pow((lat-12)/58,2)<1;
  const b=Math.pow((lon-115)/70,2)+Math.pow((lat-38)/35,2)<1;
  const c=Math.pow((lon+110)/45,2)+Math.pow((lat-32)/28,2)<1;
  const d=Math.pow((lon+60)/38,2)+Math.pow((lat+20)/27,2)<1;
  const e=Math.pow((lon+65)/23,2)+Math.pow((lat+55)/16,2)<1;
  const f=Math.pow((lon-20)/25,2)+Math.pow((lat+45)/15,2)<1;
  return a||b||c||d||e||f;
}
for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(worldShape(x,y)){
  tiles.set(key(x,y),{x,y,owner:"neutral",city:false,port:false,enemyPower:0});
}

const startX=43,startY=23;
tiles.get(key(startX,startY)).owner="player";
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const t=tiles.get(key(startX+dx,startY+dy));if(t)t.owner="border";
}
// Enemy starting nations far away
const enemyStarts=[[17,19],[74,20],[67,34]];
for(const [x,y] of enemyStarts){
  const t=tiles.get(key(x,y));
  if(t)t.owner="enemy";
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const n=tiles.get(key(x+dx,y+dy));if(n&&n.owner==="neutral")n.owner="enemy";
  }
}

function load(){
  const s=JSON.parse(localStorage.getItem(SAVE_KEY)||"null");if(!s)return;
  money=s.money??money;manpower=s.manpower??manpower;
  for(const [k,v] of Object.entries(s.tiles||{})){if(tiles.has(k))Object.assign(tiles.get(k),v)}
}
function save(){
  const obj={money,manpower,tiles:Object.fromEntries([...tiles].map(([k,v])=>[k,v]))};
  localStorage.setItem(SAVE_KEY,JSON.stringify(obj));
}
load();

function resize(){const d=devicePixelRatio||1;canvas.width=game.clientWidth*d;canvas.height=game.clientHeight*d;ctx.setTransform(d,0,0,d,0,0);draw()}
addEventListener("resize",resize);

function metrics(){
  let land=0,cities=0,ports=0;
  for(const t of tiles.values())if(t.owner==="player"){land++;if(t.city)cities++;if(t.port)ports++}
  const moneyRate=land*2+ports*8,mpRate=land*1+cities*7;
  return {land,cities,ports,moneyRate,mpRate}
}
function updateUI(){
  const m=metrics();
  moneyEl.textContent=Math.floor(money);mpEl.textContent=Math.floor(manpower);landEl.textContent=m.land;
  citiesEl.textContent=m.cities;portsEl.textContent=m.ports;
  landMoneyEl.textContent=m.land*2;portMoneyEl.textContent=m.ports*8;moneyRateEl.textContent=m.moneyRate;
  landMPEl.textContent=m.land;cityMPEl.textContent=m.cities*7;mpRateEl.textContent=m.mpRate;
  const own=selected&&selected.owner==="player",border=selected&&selected.owner==="border";
  claimBtn.disabled=!border||money<20||manpower<35;
  cityBtn.disabled=!own||selected.city||money<80;
  portBtn.disabled=!own||selected.port||money<120;
}

function screenFor(x,y){
  const w=game.clientWidth,h=game.clientHeight;
  const cellW=w/COLS,cellH=h/ROWS;
  return [x*cellW*zoom+ox,y*cellH*zoom+oy,cellW*zoom,cellH*zoom];
}
function tileAt(px,py){
  const w=game.clientWidth,h=game.clientHeight;
  const cw=w/COLS,ch=h/ROWS;
  const x=Math.floor((px-ox)/(cw*zoom)),y=Math.floor((py-oy)/(ch*zoom));
  return tiles.get(key(x,y))||null;
}
function neighbors(t){
  return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>tiles.get(key(t.x+dx,t.y+dy))).filter(Boolean);
}
function isClaimable(t){
  return t.owner==="border"|| (t.owner==="neutral" && neighbors(t).some(n=>n.owner==="player"));
}
function refreshBorders(){
  for(const t of tiles.values())if(t.owner==="border")t.owner="neutral";
  for(const t of tiles.values())if(t.owner==="player"){
    for(const n of neighbors(t))if(n.owner==="neutral")n.owner="border";
  }
}
function draw(){
  const w=game.clientWidth,h=game.clientHeight;
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#82bdd0";ctx.fillRect(0,0,w,h);
  // subtle world grid
  ctx.strokeStyle="rgba(22,66,80,.14)";ctx.lineWidth=1;
  for(let x=0;x<=COLS;x+=4){const p=screenFor(x,0);ctx.beginPath();ctx.moveTo(p[0],0);ctx.lineTo(p[0],h);ctx.stroke()}
  for(let y=0;y<=ROWS;y+=4){const p=screenFor(0,y);ctx.beginPath();ctx.moveTo(0,p[1]);ctx.lineTo(w,p[1]);ctx.stroke()}
  for(const t of tiles.values()){
    const [sx,sy,cw,ch]=screenFor(t.x,t.y);
    let fill=NEUTRAL;
    if(t.owner==="player")fill=PLAYER;
    if(t.owner==="enemy")fill=ENEMY;
    if(t.owner==="border")fill="#d6b84e";
    ctx.fillStyle=fill;ctx.fillRect(sx+0.5,sy+0.5,cw-1,ch-1);
    if(t.owner==="player"||t.owner==="enemy"){
      ctx.fillStyle="rgba(0,0,0,.10)";ctx.fillRect(sx+cw*.2,sy+ch*.2,cw*.6,ch*.6);
    }
    if(t.city){ctx.fillStyle="#f5f5f5";ctx.fillRect(sx+cw*.35,sy+ch*.28,cw*.3,ch*.4);ctx.fillStyle="#252c38";ctx.fillRect(sx+cw*.42,sy+ch*.4,cw*.12,ch*.12)}
    if(t.port){ctx.fillStyle="#1c5b87";ctx.fillRect(sx+cw*.15,sy+ch*.62,cw*.7,ch*.16)}
    if(t===selected){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(sx+1,sy+1,cw-2,ch-2)}
  }
  // Starting circle / capital marker
  const s=screenFor(startX+.5,startY+.5);
  ctx.beginPath();ctx.arc(s[0],s[1],Math.max(9,18*zoom),0,Math.PI*2);ctx.strokeStyle="#eafff2";ctx.lineWidth=3;ctx.stroke();
  ctx.beginPath();ctx.arc(s[0],s[1],5,0,Math.PI*2);ctx.fillStyle=PLAYER;ctx.fill();
}

function select(t){
  selected=t||null;
  if(!t){selectionEl.textContent="Click a border tile to select it.";updateUI();draw();return}
  let owner=t.owner==="player"?"Your territory":t.owner==="enemy"?"Enemy territory":t.owner==="border"?"Frontier / claimable":"Unclaimed";
  selectionEl.innerHTML=`<b>${owner}</b><br>${t.city?"🏙 City · ":""}${t.port?"⚓ Port · ":""}Tile ${t.x}, ${t.y}`;
  updateUI();draw();
}

claimBtn.onclick=()=>{
  if(!selected||!isClaimable(selected)||money<20||manpower<35)return;
  money-=20;manpower-=35;selected.owner="player";selected.city=false;selected.port=false;
  refreshBorders();save();select(selected);
};
cityBtn.onclick=()=>{
  if(!selected||selected.owner!=="player"||selected.city||money<80)return;
  money-=80;selected.city=true;save();updateUI();draw();
};
portBtn.onclick=()=>{
  if(!selected||selected.owner!=="player"||selected.port||money<120)return;
  money-=120;selected.port=true;save();updateUI();draw();
};

setInterval(()=>{
  const m=metrics();money+=m.moneyRate;manpower+=m.mpRate;
  // Enemy fronts slowly push into neutral land.
  if(Math.random()<0.18){
    const fronts=[...tiles.values()].filter(t=>t.owner==="enemy").flatMap(t=>neighbors(t).filter(n=>n.owner==="neutral"));
    if(fronts.length){const t=fronts[Math.floor(Math.random()*fronts.length)];t.owner="enemy"}
  }
  refreshBorders();updateUI();draw();
},1000);

canvas.addEventListener("pointerdown",e=>{drag=true;moved=false;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);canvas.classList.add("dragging")});
canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;ox+=dx;oy+=dy;lastX=e.clientX;lastY=e.clientY;draw()});
canvas.addEventListener("pointerup",e=>{drag=false;canvas.classList.remove("dragging");if(!moved)select(tileAt(e.offsetX,e.offsetY))});
canvas.addEventListener("wheel",e=>{
  e.preventDefault();const beforeX=(e.offsetX-ox),beforeY=(e.offsetY-oy);
  const old=zoom;zoom=Math.max(.55,Math.min(7,zoom*(e.deltaY<0?1.12:.89)));
  ox=e.offsetX-beforeX*(zoom/old);oy=e.offsetY-beforeY*(zoom/old);draw()
},{passive:false});

document.getElementById("save").onclick=()=>{save();document.getElementById("save").textContent="GAME SAVED";setTimeout(()=>document.getElementById("save").textContent="SAVE GAME",1000)};
document.getElementById("reset").onclick=()=>{if(confirm("Reset the entire world?")){localStorage.removeItem(SAVE_KEY);location.reload()}};

resize();refreshBorders();updateUI();draw();
