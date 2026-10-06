const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const moneyEl = document.getElementById('money');
const manpowerEl = document.getElementById('manpower');
const landEl = document.getElementById('land');
const modeEl = document.getElementById('mode');
const toastEl = document.getElementById('toast');

const W=900,H=450, N=W*H;
const owner=new Uint8Array(N); // 0 water, 1 unclaimed, 2 player, 3 attacker, 4 economist, 5 ranged
const land=new Uint8Array(N);
const region=new Int16Array(N);
const cities=[],ports=[];
const bots=[
 {id:3,name:'Attacker',type:'attacker',money:4200,manpower:6200,rate:.8,cool:0},
 {id:4,name:'Economist',type:'economist',money:6200,manpower:5200,rate:.8,cool:0},
 {id:5,name:'Ranged',type:'ranged',money:5000,manpower:5400,rate:.8,cool:0}
];
let money=5000,manpower=7000,mode='push',started=false,chooseStart=true;
let zoom=1,panX=0,panY=0,drag=null;
let attacks=[],attackId=1,last=0,toastTimer=0;
const colors={water:'#071522',unclaimed:'#203247',player:'#38a8ff',attacker:'#e85b6d',economist:'#61d18a',ranged:'#b985ff',border:'#bfe9ff'};

// Offline world geometry. No external map/CDN requests are needed.
// Coordinates are lon/lat-like and are intentionally detailed enough for a smooth pixel map.
const continents=[
 {id:1,name:'North America',pts:[[-168,72],[-150,70],[-135,72],[-125,68],[-118,64],[-112,58],[-104,54],[-96,50],[-90,48],[-84,46],[-80,42],[-75,40],[-70,44],[-66,49],[-60,52],[-62,58],[-72,61],[-82,65],[-95,68],[-110,70],[-125,74],[-145,75]],holes:[]},
 {id:2,name:'Central America',pts:[[-96,30],[-88,27],[-83,20],[-78,14],[-80,8],[-86,10],[-90,16],[-94,22]],holes:[]},
 {id:3,name:'South America',pts:[[-81,12],[-74,10],[-68,8],[-60,5],[-52,0],[-46,-5],[-43,-15],[-47,-25],[-52,-34],[-58,-42],[-66,-52],[-72,-55],[-76,-47],[-78,-35],[-80,-22],[-83,-8]],holes:[]},
 {id:4,name:'Europe',pts:[[-11,36],[-5,43],[2,43],[8,47],[15,45],[22,47],[28,52],[35,56],[32,62],[25,66],[17,63],[10,59],[3,55],[-4,55],[-10,51],[-14,45]],holes:[]},
 {id:5,name:'Africa',pts:[[-17,36],[-5,35],[8,37],[20,34],[31,31],[40,20],[45,8],[42,-5],[36,-18],[30,-28],[20,-35],[9,-35],[1,-30],[-7,-22],[-12,-8],[-16,8]],holes:[]},
 {id:6,name:'Asia',pts:[[28,40],[38,43],[50,48],[62,52],[75,55],[90,55],[105,52],[118,55],[132,52],[145,49],[158,55],[170,62],[178,55],[175,45],[165,40],[158,34],[150,31],[145,24],[138,20],[128,23],[120,28],[112,25],[105,20],[96,18],[90,12],[80,10],[72,14],[65,20],[55,25],[45,30],[35,32]],holes:[]},
 {id:7,name:'Australia',pts:[[112,-11],[125,-12],[138,-16],[151,-22],[153,-31],[147,-39],[136,-43],[123,-39],[114,-31],[110,-20]],holes:[]},
 {id:8,name:'Greenland',pts:[[-73,59],[-55,58],[-40,64],[-24,72],[-30,82],[-52,84],[-66,77],[-73,68]],holes:[]},
 {id:9,name:'Japan',pts:[[137,36],[141,43],[146,42],[146,35],[142,30],[137,32]],holes:[]},
 {id:10,name:'Madagascar',pts:[[45,-13],[50,-15],[51,-25],[47,-27],[43,-20]],holes:[]}
];

function idx(x,y){return y*W+x} function inside(x,y){return x>=0&&y>=0&&x<W&&y<H}
function lonLatToGrid(lon,lat){return {x:Math.round((lon+180)/360*(W-1)),y:Math.round((90-lat)/180*(H-1))}}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++) {const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);if(hit)inside=!inside}return inside}
function rasterizeWorld(){
 land.fill(0);region.fill(0);
 for(const c of continents){
   let minLon=180,maxLon=-180,minLat=90,maxLat=-90;c.pts.forEach(p=>{minLon=Math.min(minLon,p[0]);maxLon=Math.max(maxLon,p[0]);minLat=Math.min(minLat,p[1]);maxLat=Math.max(maxLat,p[1])});
   const a=lonLatToGrid(minLon,minLat),b=lonLatToGrid(maxLon,maxLat); const x0=Math.max(0,Math.min(a.x,b.x)-2),x1=Math.min(W-1,Math.max(a.x,b.x)+2),y0=Math.max(0,Math.min(a.y,b.y)-2),y1=Math.min(H-1,Math.max(a.y,b.y)+2);
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const lon=x/(W-1)*360-180,lat=90-y/(H-1)*180;if(pointInPoly(lon,lat,c.pts)){land[idx(x,y)]=1;region[idx(x,y)]=c.id}}
 }
 // add a few small islands
 for(const [lon,lat,r] of [[-155,20,3],[-17,28,2],[32,35,2],[121,14,2],[100,4,2],[7,62,2]]){const p=lonLatToGrid(lon,lat);for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++)if(x*x+y*y<=r*r&&inside(p.x+x,p.y+y)){land[idx(p.x+x,p.y+y)]=1;region[idx(p.x+x,p.y+y)]=99}}
 owner.fill(0);for(let i=0;i<N;i++)if(land[i])owner[i]=1;
}
function resize(){const d=Math.min(2,devicePixelRatio||1);canvas.width=innerWidth*d;canvas.height=innerHeight*d;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(d,0,0,d,0,0);draw()}
window.addEventListener('resize',resize);
function colorFor(o){return o===2?colors.player:o===3?colors.attacker:o===4?colors.economist:o===5?colors.ranged:colors.unclaimed}
function neighbors(x,y){return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]}
function isLand(x,y){return inside(x,y)&&land[idx(x,y)]}
function ownerAt(x,y){return inside(x,y)?owner[idx(x,y)]:0}
function paintCircle(cx,cy,r,who){for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if(isLand(x,y)&&Math.hypot(x-cx,y-cy)<=r)owner[idx(x,y)]=who}
function nearestLand(x,y){if(isLand(x,y))return{x,y};for(let r=1;r<100;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.abs(dx)===r||Math.abs(dy)===r)if(isLand(x+dx,y+dy))return{x:x+dx,y:y+dy};return{x,y}}
function randomLandFar(starts){for(let k=0;k<10000;k++){const x=Math.floor(Math.random()*W),y=Math.floor(Math.random()*H);if(isLand(x,y)&&starts.every(s=>Math.hypot(s.x-x,s.y-y)>70))return{x,y}}return nearestLand(Math.random()*W|0,Math.random()*H|0)}
function startAt(x,y){const s=nearestLand(x,y);paintCircle(s.x,s.y,13,2);const starts=[s];bots.forEach(b=>{const p=randomLandFar(starts);paintCircle(p.x,p.y,11,b.id);b.spawn=p;starts.push(p)});chooseStart=false;started=true;toast('Start position selected. Click land to expand.');refresh();draw()}
function screenToGrid(sx,sy){const r=canvas.getBoundingClientRect();return{x:Math.floor((sx-r.left-innerWidth/2-panX)/zoom+W/2),y:Math.floor((sy-r.top-innerHeight/2-panY)/zoom+H/2)}}
function gridToScreen(x,y){return{x:innerWidth/2+panX+(x-W/2)*zoom,y:innerHeight/2+panY+(y-H/2)*zoom}}
function frontierCells(who,targetX,targetY){const out=[];for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(ownerAt(x,y)===who)continue;if(!isLand(x,y))continue;let n=0;for(const [dx,dy] of neighbors(x,y))if(ownerAt(x+dx,y+dy)===who)n++;if(n)out.push({x,y,d:Math.hypot(x-targetX,y-targetY)})}return out.sort((a,b)=>a.d-b.d)}
function bfsPath(start,target,who){const q=[start],came=new Int32Array(N);came.fill(-1);const seen=new Uint8Array(N);seen[idx(start.x,start.y)]=1;while(q.length){const p=q.shift(),pi=idx(p.x,p.y);if(p.x===target.x&&p.y===target.y){const path=[];let k=pi;while(k!==-1){path.push({x:k%W,y:k/W|0});if(k===idx(start.x,start.y))break;k=came[k]}return path.reverse()}for(const [dx,dy] of neighbors(p.x,p.y)){const x=p.x+dx,y=p.y+dy;if(!isLand(x,y)||seen[idx(x,y)])continue;const o=ownerAt(x,y);if(o!==who&&o!==1&&o!==0&&o!==target.owner)continue;seen[idx(x,y)]=1;came[idx(x,y)]=pi;q.push({x,y})}}return[]}
function waveCells(who,target){const front=frontierCells(who,target.x,target.y);if(!front.length)return[];const seeds=front.slice(0,Math.min(30,front.length));const q=seeds.map(p=>({...p,depth:0}));const seen=new Set(),out=[];const max=700;while(q.length&&out.length<max){const p=q.shift(),k=idx(p.x,p.y);if(seen.has(k))continue;seen.add(k);if(ownerAt(p.x,p.y)===who||!isLand(p.x,p.y))continue;out.push(p);for(const [dx,dy] of neighbors(p.x,p.y)){const x=p.x+dx,y=p.y+dy;if(isLand(x,y)&&ownerAt(x,y)!==who&&!seen.has(idx(x,y)))q.push({x,y,depth:p.depth+1})}}return out.sort((a,b)=>a.depth-b.depth||Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(b.x-target.x,b.y-target.y))}
function addAttack(target){if(!started||!isLand(target.x,target.y))return;if(ownerAt(target.x,target.y)===2)return;const existing=attacks.find(a=>a.who===2&&a.region===region[idx(target.x,target.y)]&&a.active);if(existing){const add=Math.min(260,manpower);manpower-=add;existing.troops+=add;toast('Reinforced attack: +'+Math.floor(add).toLocaleString()+' troops');refresh();return}const front=frontierCells(2,target.x,target.y)[0];if(!front){toast('No reachable frontier.');return}const cells=waveCells(2,target);const cid=region[idx(target.x,target.y)];const job={id:attackId++,who:2,target,region:cid,cells,cursor:0,troops:Math.min(450,manpower),active:true};manpower-=job.troops;attacks.push(job);toast('Attack point added. Click the same area to reinforce.');refresh()}
function localDefense(o){const b=bots.find(x=>x.id===o);return b?Math.max(20,Math.floor(b.manpower*.012)):0}
function stepAttack(a,steps){for(let s=0;s<steps&&a.cursor<a.cells.length&&a.active;s++){const p=a.cells[a.cursor],o=ownerAt(p.x,p.y);if(o===a.who){a.cursor++;continue}const terrain=o===1?30:18;const def=o>=3&&o!==a.who?localDefense(o):0;const need=terrain+def;const ratio=a.troops/Math.max(1,need);const loss=o===1?Math.ceil(terrain*1.4):Math.ceil(Math.max(terrain,need*.45));a.troops=Math.max(0,a.troops-loss);if(a.troops<=0){a.active=false;break}if(o===1){if(ratio>=.35||a.troops>terrain*2){owner[idx(p.x,p.y)]=a.who;a.cursor++}else break}else if(o>=3&&o!==a.who){if(a.troops>need){owner[idx(p.x,p.y)]=a.who;const b=bots.find(x=>x.id===o);if(b)b.manpower=Math.max(0,b.manpower-Math.ceil(loss*.8));a.cursor++}else{a.troops=Math.max(0,a.troops-Math.ceil(need*.35));if(a.troops<need*.25)a.active=false;break}}else a.cursor++}}
function botsThink(){for(const b of bots){b.manpower+=Math.max(1,Math.floor(countFor(b.id).land*.8));b.money+=Math.max(1,Math.floor(countFor(b.id).land*1.6));b.cool-=1;if(b.cool>0)continue;b.cool=6+Math.random()*8;let target=null;if(b.type==='attacker'){target=nearestEnemyFront(b.id)}else if(b.type==='economist'){target=nearestEnemyFront(b.id)}else{const active=attacks.find(a=>a.who!==b.id&&a.active);target=active?active.target:nearestEnemyFront(b.id)}if(!target)continue;let existing=attacks.find(a=>a.who===b.id&&a.region===region[idx(target.x,target.y)]&&a.active);if(existing){existing.troops+=Math.min(160,b.manpower*.08);b.manpower-=Math.min(160,b.manpower*.08)}else{const t=Math.min(360,b.manpower*.12);b.manpower-=t;attacks.push({id:attackId++,who:b.id,target,region:region[idx(target.x,target.y)],cells:waveCells(b.id,target),cursor:0,troops:t,active:true})}}}
function nearestEnemyFront(who){let best=null,bd=1e9;for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2)if(isLand(x,y)&&ownerAt(x,y)!==who&&ownerAt(x,y)!==0){let adj=false;for(const [dx,dy] of neighbors(x,y))if(ownerAt(x+dx,y+dy)===who){adj=true;break}if(adj){const d=who===2?Math.random()*500:Math.random()*900;if(d<bd){bd=d;best={x,y}}}}return best}
function countFor(who){let landN=0;for(let i=0;i<N;i++)if(owner[i]===who)landN++;return{land:landN,city:cities.filter(x=>x.owner===who).length,port:ports.filter(x=>x.owner===who).length}}
function refresh(){const c=countFor(2);moneyEl.textContent=Math.floor(money).toLocaleString();manpowerEl.textContent=Math.floor(manpower).toLocaleString();landEl.textContent=c.land.toLocaleString();modeEl.textContent=mode[0].toUpperCase()+mode.slice(1)}
function toast(t){toastEl.textContent=t;toastEl.style.opacity=1;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.style.opacity=0,1800)}
function isSeaNear(x,y){for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++)if(inside(x+dx,y+dy)&&!isLand(x+dx,y+dy))return true;return false}
function addCity(x,y){if(!isLand(x,y)||ownerAt(x,y)!==2||money<80)return;if(cities.some(c=>Math.hypot(c.x-x,c.y-y)<18))return;money-=80;cities.push({x,y,owner:2});toast('City built');refresh()}
function addPort(x,y){if(!isLand(x,y)||ownerAt(x,y)!==2||!isSeaNear(x,y)||money<120)return;if(ports.some(p=>Math.hypot(p.x-x,p.y-y)<18))return;money-=120;ports.push({x,y,owner:2});toast('Port built');refresh()}
function draw(){ctx.clearRect(0,0,innerWidth,innerHeight);ctx.save();ctx.translate(innerWidth/2+panX,innerHeight/2+panY);ctx.scale(zoom,zoom);ctx.translate(-W/2,-H/2);ctx.fillStyle=colors.water;ctx.fillRect(0,0,W,H);
 const step=1;for(let y=0;y<H;y+=step){for(let x=0;x<W;x+=step){const o=ownerAt(x,y);if(!o)continue;ctx.fillStyle=colorFor(o);ctx.fillRect(x,y,step+.25,step+.25)}}
 // soft frontier glow
 for(let y=1;y<H-1;y+=2)for(let x=1;x<W-1;x+=2){if(ownerAt(x,y)!==2)continue;let edge=false;for(const [dx,dy] of neighbors(x,y))if(ownerAt(x+dx,y+dy)!==2&&isLand(x+dx,y+dy)){edge=true;break}if(edge){ctx.fillStyle='rgba(190,235,255,.22)';ctx.fillRect(x,y,1.5,1.5)}}
 for(const a of attacks.filter(a=>a.active)){const p=a.cells[Math.min(a.cursor,a.cells.length-1)];if(!p)continue;ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle=a.who===2?'#ffffff':colorFor(a.who);ctx.fill();ctx.font='7px Arial';ctx.fillStyle='#fff';ctx.fillText(Math.floor(a.troops).toLocaleString(),p.x+5,p.y-5)}
 for(const c of cities){if(ownerAt(c.x,c.y)!==c.owner)continue;ctx.beginPath();ctx.arc(c.x,c.y,4,0,Math.PI*2);ctx.fillStyle=colors.city;ctx.fill();ctx.font='7px Arial';ctx.fillStyle='#222';ctx.fillText('⌂',c.x-2.5,c.y+2)}
 for(const p of ports){if(ownerAt(p.x,p.y)!==p.owner)continue;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=colors.port;ctx.fill();ctx.font='7px Arial';ctx.fillStyle='#083';ctx.fillText('♜',p.x-2.5,p.y+2)}
 ctx.restore()}
function tick(now){if(!last)last=now;const dt=Math.min(.1,(now-last)/1000);last=now;if(started){const c=countFor(2);money+=c.land*2*dt+c.port*8*dt;manpower+=c.land*1*dt+c.city*7*dt;bots.forEach(b=>{const bc=countFor(b.id);b.money+=bc.land*1.6*dt;b.manpower+=bc.land*.8*dt});for(const a of attacks)if(a.active)stepAttack(a,a.who===2?2:Math.max(1,Math.floor(2*.8)));botsThink();attacks=attacks.filter(a=>a.active||a.troops>0);for(const p of ports)if(ownerAt(p.x,p.y)!==p.owner)p.owner=ownerAt(p.x,p.y);for(const c of cities)if(ownerAt(c.x,c.y)!==c.owner)c.owner=ownerAt(c.x,c.y);refresh();draw()}requestAnimationFrame(tick)}
canvas.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,ox:panX,oy:panY,moved:false}});
canvas.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;panX=drag.ox+dx;panY=drag.oy+dy;draw()});
canvas.addEventListener('mouseup',e=>{if(!drag)return;const moved=drag.moved;drag=null;if(moved)return;const p=screenToGrid(e.clientX,e.clientY);if(!inside(p.x,p.y))return;if(chooseStart){if(isLand(p.x,p.y))startAt(p.x,p.y);return}if(mode==='push')addAttack(p);else if(mode==='city')addCity(p.x,p.y);else if(mode==='port')addPort(p.x,p.y)});
canvas.addEventListener('wheel',e=>{e.preventDefault();const before=screenToGrid(e.clientX,e.clientY);zoom=Math.max(.7,Math.min(8,zoom*(e.deltaY<0?1.12:.89)));const after=screenToGrid(e.clientX,e.clientY);panX+=(after.x-before.x)*zoom;panY+=(after.y-before.y)*zoom;draw()},{passive:false});
document.getElementById('pushMode').onclick=()=>{mode='push';refresh()};document.getElementById('cityMode').onclick=()=>{mode='city';refresh()};document.getElementById('portMode').onclick=()=>{mode='port';refresh()};document.getElementById('reset').onclick=()=>location.reload();document.getElementById('save').onclick=()=>{try{localStorage.setItem('pwc_save',JSON.stringify({owner:Array.from(owner),money,manpower,cities,ports}));toast('Game saved')}catch(e){toast('Save failed')}};
window.addEventListener('keydown',e=>{if(e.key==='c')mode='city';if(e.key==='p')mode='port';if(e.key==='Escape')mode='push';refresh()});
function loadSaved(){try{const s=JSON.parse(localStorage.getItem('pwc_save'));if(!s)return false;owner.set(s.owner);money=s.money;manpower=s.manpower;cities.push(...(s.cities||[]));ports.push(...(s.ports||[]));started=true;chooseStart=false;return true}catch(e){return false}}
rasterizeWorld();resize();if(!loadSaved()){}refresh();requestAnimationFrame(tick);
