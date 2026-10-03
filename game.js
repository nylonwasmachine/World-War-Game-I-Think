const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const game = document.getElementById("game");
const selectedEl = document.getElementById("selected");
const conquerBtn = document.getElementById("conquer");
const coinsEl = document.getElementById("coins");
const incomeEl = document.getElementById("income");
const ownedEl = document.getElementById("owned");
const tip = document.getElementById("tip");

let countries = [];
let selected = null;
let coins = 100;
let zoom = 1;
let offsetX = 0, offsetY = 0;
let dragging = false, lastX = 0, lastY = 0;
let pointerMoved = false;

const state = JSON.parse(localStorage.getItem("worldConquestSave") || "null") || {};

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = game.clientWidth * dpr;
  canvas.height = game.clientHeight * dpr;
  canvas.style.width = game.clientWidth + "px";
  canvas.style.height = game.clientHeight + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  draw();
}
window.addEventListener("resize", resize);

function project(lon, lat) {
  const w = game.clientWidth, h = game.clientHeight;
  const x = (lon + 180) / 360 * w;
  const y = (90 - lat) / 180 * h;
  return [x * zoom + offsetX, y * zoom + offsetY];
}

function unproject(x, y) {
  const w = game.clientWidth, h = game.clientHeight;
  return [(x-offsetX)/zoom / w * 360 - 180, 90 - ((y-offsetY)/zoom / h * 180)];
}

function colorFor(c) {
  if (c.owner === "player") return "#39d98a";
  if (c.owner === "ai") return "#d85858";
  return "#8793a3";
}

function draw() {
  if (!countries.length) return;
  const w = game.clientWidth, h = game.clientHeight;
  ctx.clearRect(0,0,w,h);

  // Ocean grid
  ctx.fillStyle = "#8bc6d8"; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = "rgba(20,70,90,.14)"; ctx.lineWidth = 1;
  for (let lon=-180; lon<=180; lon+=15) {
    const a=project(lon,-90), b=project(lon,90);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  }
  for (let lat=-75; lat<=75; lat+=15) {
    const a=project(-180,lat), b=project(180,lat);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
  }

  for (const c of countries) {
    ctx.beginPath();
    for (const ring of c.rings) {
      ring.forEach((p,i)=>{
        const q=project(p[0],p[1]);
        if(i===0) ctx.moveTo(q[0],q[1]); else ctx.lineTo(q[0],q[1]);
      });
      ctx.closePath();
    }
    ctx.fillStyle = colorFor(c);
    ctx.fill();
    ctx.strokeStyle = c === selected ? "#fff" : "#263847";
    ctx.lineWidth = c === selected ? 2.5 : .8;
    ctx.stroke();
  }
}

function pointInPolygon(point, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const xi=polygon[i][0], yi=polygon[i][1], xj=polygon[j][0], yj=polygon[j][1];
    const hit=((yi>point[1]) !== (yj>point[1])) &&
      point[0] < (xj-xi)*(point[1]-yi)/(yj-yi)+xi;
    if(hit) inside=!inside;
  }
  return inside;
}

function pickCountry(px,py) {
  const geo=unproject(px,py);
  for (let i=countries.length-1;i>=0;i--) {
    const c=countries[i];
    if(c.rings.some(r=>pointInPolygon(geo,r))) return c;
  }
  return null;
}

function showCountry(c) {
  selected=c;
  if(!c) {
    selectedEl.textContent="Click a country on the map.";
    conquerBtn.disabled=true;
  } else {
    const owner=c.owner==="player" ? "YOU" : c.owner==="ai" ? "Enemy" : "Neutral";
    selectedEl.innerHTML = `<strong>${c.name}</strong><br>Owner: ${owner}<br>Population: ${c.pop.toLocaleString()}<br>Conquest cost: ${c.cost} 💰`;
    conquerBtn.textContent = c.owner==="player" ? "ALREADY YOURS" : `CONQUER — ${c.cost} 💰`;
    conquerBtn.disabled = c.owner==="player" || coins < c.cost;
  }
  draw();
}

conquerBtn.onclick=()=>{
  if(!selected || selected.owner==="player" || coins<selected.cost) return;
  coins-=selected.cost;
  selected.owner="player";
  selected.cost=Math.min(200, Math.round(selected.cost*1.08));
  showCountry(selected);
  updateUI();
  save();
};

function updateUI() {
  const owned=countries.filter(c=>c.owner==="player").length;
  coinsEl.textContent=Math.floor(coins);
  incomeEl.textContent=5+owned*2;
  ownedEl.textContent=owned;
  if(selected) conquerBtn.disabled=selected.owner==="player" || coins<selected.cost;
}

setInterval(()=>{
  const owned=countries.filter(c=>c.owner==="player").length;
  coins += 5 + owned*2;
  updateUI();
},1000);

function save() {
  localStorage.setItem("worldConquestSave", JSON.stringify({
    coins, owners:Object.fromEntries(countries.map(c=>[c.id,c.owner]))
  }));
}

document.getElementById("save").onclick=()=>{
  save();
  tip.textContent="Game saved!";
  tip.style.display="block";
  tip.style.left="20px"; tip.style.top="20px";
  setTimeout(()=>tip.style.display="none",1200);
};

document.getElementById("reset").onclick=()=>{
  if(confirm("Reset your world conquest save?")) {
    localStorage.removeItem("worldConquestSave");
    location.reload();
  }
};

canvas.addEventListener("pointerdown",e=>{
  dragging=true; pointerMoved=false; lastX=e.clientX; lastY=e.clientY;
  canvas.classList.add("dragging"); canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove",e=>{
  if(!dragging) {
    const c=pickCountry(e.offsetX,e.offsetY);
    tip.style.display=c?"block":"none";
    if(c){ tip.textContent=c.name; tip.style.left=(e.offsetX+12)+"px"; tip.style.top=(e.offsetY+12)+"px"; }
    return;
  }
  const dx=e.clientX-lastX,dy=e.clientY-lastY;
  if(Math.abs(dx)+Math.abs(dy)>2) pointerMoved=true;
  offsetX+=dx; offsetY+=dy; lastX=e.clientX; lastY=e.clientY; draw();
});
canvas.addEventListener("pointerup",e=>{
  dragging=false; canvas.classList.remove("dragging");
  if(!pointerMoved) showCountry(pickCountry(e.offsetX,e.offsetY));
});
canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  const before=unproject(e.offsetX,e.offsetY);
  zoom=Math.max(.65,Math.min(6,zoom*(e.deltaY<0?1.12:.89)));
  const after=project(before[0],before[1]);
  offsetX+=e.offsetX-after[0]; offsetY+=e.offsetY-after[1];
  draw();
},{passive:false});

async function loadWorld() {
  const res=await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
  const topo=await res.json();
  const features=topojson.feature(topo,topo.objects.countries).features;

  countries=features.map((f,i)=>{
    const rings=[];
    const coords=f.geometry.coordinates;
    if(f.geometry.type==="Polygon") rings.push(...coords);
    else coords.forEach(poly=>rings.push(...poly));
    const old=state.owners?.[f.id];
    return {
      id:f.id,
      name: f.properties.name || `Territory ${i+1}`,
      rings:rings.map(r=>r.map(p=>[p[0],p[1]])),
      owner:old || (i<8 ? "ai" : "neutral"),
      pop:Math.round(500000+Math.random()*90000000),
      cost:20+Math.floor(Math.random()*60)
    };
  });

  // Give the player a starting territory.
  const start=countries.find(c=>c.id==="528") || countries.find(c=>c.owner==="neutral");
  if(!state.owners && start) start.owner="player";
  coins=state.coins ?? 100;
  resize(); updateUI();
}
loadWorld().catch(err=>{
  selectedEl.innerHTML="<b>Map failed to load.</b><br>Please make sure GitHub Pages/browser access to the map data is allowed.";
  console.error(err);
});
