import { useState, useEffect, useRef, useCallback } from "react";

// ── 백엔드 URL: Render 배포 후 실제 URL로 교체
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

// ── XML 파서
function parseItems(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    return Array.from(doc.querySelectorAll("item")).map(item => {
      const obj = {};
      item.childNodes.forEach(n => { if (n.nodeType === 1) obj[n.tagName] = n.textContent.trim(); });
      return obj;
    });
  } catch { return []; }
}
function parseTotal(xmlText) {
  try { return parseInt(new DOMParser().parseFromString(xmlText,"text/xml").querySelector("totalCount")?.textContent||"0"); }
  catch { return 0; }
}

// ── API 호출 (백엔드 프록시 경유)
async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { xml } = await res.json();
  return xml;
}

async function fetchRouteList(cityCode, pageNo = 1) {
  const xml = await api("/api/routes", { cityCode, numOfRows: 100, pageNo });
  return { items: parseItems(xml), total: parseTotal(xml) };
}
async function fetchRouteInfo(cityCode, routeId) {
  const xml = await api("/api/route-info", { cityCode, routeId });
  return parseItems(xml)[0] || null;
}
async function fetchRouteStops(cityCode, routeId, pageNo = 1) {
  const xml = await api("/api/route-stops", { cityCode, routeId, numOfRows: 200, pageNo });
  return { items: parseItems(xml), total: parseTotal(xml) };
}

// ── 분석 함수
function calcDetour(stops) {
  if (stops.length < 2) return 1.0;
  const toRad = d => d * Math.PI / 180;
  const hav = (a, b) => {
    const R=6371, dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
    const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  };
  let total=0; for(let i=0;i<stops.length-1;i++) total+=hav(stops[i],stops[i+1]);
  const direct=hav(stops[0],stops[stops.length-1]);
  return direct>0 ? Math.round((total/direct)*10)/10 : 1.0;
}
function calcOverlap(allStops, targetId) {
  const ids=new Set((allStops[targetId]||[]).map(s=>s.id));
  if(!ids.size) return 0;
  let n=0;
  Object.entries(allStops).forEach(([rid,stops])=>{ if(rid!==targetId) stops.forEach(s=>{ if(ids.has(s.id)) n++; }); });
  return Math.min(100,Math.round((n/ids.size)*100));
}
function calcScore(gap,detour,overlap) {
  return Math.round(Math.min(100,gap/60*100)*0.5+Math.min(100,(detour-1)/1.5*100)*0.3+overlap*0.2);
}
const scoreColor = s => s>=70?"#E24B4A":s>=45?"#EF9F27":"#639922";
const scoreLabel = s => s>=70?"불편 높음":s>=45?"주의":"양호";
const scoreBg    = s => s>=70?{bg:"#FCEBEB",c:"#A32D2D"}:s>=45?{bg:"#FAEEDA",c:"#854F0B"}:{bg:"#EAF3DE",c:"#3B6D11"};

// ── 지도 캔버스
function MapCanvas({ routes, selectedId, onSelect, filter }) {
  const ref = useRef(null);
  const LAT_MIN=35.88, LAT_MAX=36.05, LON_MIN=126.55, LON_MAX=126.85;
  const proj = useCallback((lat,lon,W,H)=>({
    x:((lon-LON_MIN)/(LON_MAX-LON_MIN))*W,
    y:H-((lat-LAT_MIN)/(LAT_MAX-LAT_MIN))*H
  }),[]);

  useEffect(()=>{
    const c=ref.current; if(!c) return;
    const ctx=c.getContext("2d"), W=c.width, H=c.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#f0ede8"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#ddd8d0"; ctx.lineWidth=0.5;
    for(let i=0;i<10;i++){
      ctx.beginPath(); ctx.moveTo(i/10*W,0); ctx.lineTo(i/10*W,H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i/10*H); ctx.lineTo(W,i/10*H); ctx.stroke();
    }
    const vis=routes.filter(r=>{
      if(filter==="gap")     return r.gap>=30;
      if(filter==="detour")  return r.detour>=1.5;
      if(filter==="overlap") return r.overlapPct>=40;
      return true;
    });
    vis.forEach(r=>{
      const stops=r.stops; if(!stops||stops.length<2) return;
      const sel=r.id===selectedId;
      ctx.globalAlpha=selectedId&&!sel?0.2:1;
      ctx.strokeStyle=scoreColor(r.score); ctx.lineWidth=sel?4:2.5;
      ctx.lineCap="round"; ctx.lineJoin="round";
      ctx.beginPath();
      stops.forEach((s,i)=>{ const {x,y}=proj(s.lat,s.lon,W,H); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke();
      const mid=stops[Math.floor(stops.length/2)];
      const {x,y}=proj(mid.lat,mid.lon,W,H);
      ctx.fillStyle=scoreColor(r.score);
      ctx.beginPath(); ctx.roundRect(x-16,y-9,32,16,3); ctx.fill();
      ctx.fillStyle="#fff"; ctx.font="bold 10px sans-serif";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(r.routeno,x,y);
    });
    ctx.globalAlpha=1;
    vis.forEach(r=>{
      (r.stops||[]).forEach(s=>{
        const {x,y}=proj(s.lat,s.lon,W,H), sel=r.id===selectedId;
        ctx.beginPath(); ctx.arc(x,y,sel?4:2.5,0,Math.PI*2);
        ctx.fillStyle="#fff"; ctx.fill();
        ctx.strokeStyle=scoreColor(r.score); ctx.lineWidth=sel?2:1; ctx.stroke();
      });
    });
    ctx.globalAlpha=1;
  },[routes,selectedId,filter,proj]);

  const onClick=useCallback(e=>{
    const c=ref.current, rect=c.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(c.width/rect.width);
    const my=(e.clientY-rect.top)*(c.height/rect.height);
    let closest=null, minD=20;
    routes.forEach(r=>(r.stops||[]).forEach(s=>{
      const {x,y}=proj(s.lat,s.lon,c.width,c.height);
      const d=Math.hypot(x-mx,y-my);
      if(d<minD){minD=d;closest=r;}
    }));
    if(closest) onSelect(closest.id===selectedId?null:closest.id);
  },[routes,selectedId,onSelect,proj]);

  return <canvas ref={ref} width={480} height={480} onClick={onClick}
    style={{width:"100%",height:"100%",cursor:"crosshair",display:"block"}}/>;
}

// ── 메인 앱
export default function App() {
  const [cityCode, setCityCode]   = useState("37050");
  const [step, setStep]           = useState("input");
  const [loadMsg, setLoadMsg]     = useState("");
  const [loadPct, setLoadPct]     = useState(0);
  const [routes, setRoutes]       = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter]       = useState("all");
  const [errorMsg, setErrorMsg]   = useState("");
  const sel = routes.find(r=>r.id===selectedId);

  async function loadData() {
    setStep("loading"); setLoadPct(5);
    try {
      setLoadMsg("노선 목록 조회 중...");
      const {items:routeItems}=await fetchRouteList(cityCode);
      if(!routeItems.length) throw new Error("노선 없음 — 도시코드 확인 필요 (군산: 37050)");
      setLoadPct(20);

      setLoadMsg(`노선 상세정보 (${routeItems.length}개)...`);
      const details=[];
      for(let i=0;i<Math.min(routeItems.length,20);i++){
        const info=await fetchRouteInfo(cityCode,routeItems[i].routeid);
        details.push({...routeItems[i],...info});
        setLoadPct(20+Math.round(i/Math.min(routeItems.length,20)*30));
      }

      setLoadMsg("정류장 좌표 수집 중...");
      const allStops={};
      for(let i=0;i<details.length;i++){
        const {items}=await fetchRouteStops(cityCode,details[i].routeid);
        allStops[details[i].routeid]=items
          .map(s=>({id:s.nodeid,name:s.nodenm,lat:parseFloat(s.gpslati),lon:parseFloat(s.gpslong),seq:parseInt(s.nodeord)}))
          .filter(s=>!isNaN(s.lat)&&!isNaN(s.lon))
          .sort((a,b)=>a.seq-b.seq);
        setLoadPct(50+Math.round(i/details.length*40));
      }

      setLoadMsg("불편 지표 계산 중...");
      const processed=details.map(r=>{
        const stops=allStops[r.routeid]||[];
        const gap=parseInt(r.intervaltime)||60;
        const detour=calcDetour(stops);
        const overlapPct=calcOverlap(allStops,r.routeid);
        const score=calcScore(gap,detour,overlapPct);
        return { id:r.routeid, routeno:r.routeno||r.routeid, routetp:r.routetp||"",
          startnodenm:r.startnodenm||"", endnodenm:r.endnodenm||"",
          startvehicletime:r.startvehicletime||"-", endvehicletime:r.endvehicletime||"-",
          gap, detour, overlapPct, score, stops };
      }).sort((a,b)=>b.score-a.score);
      setRoutes(processed); setLoadPct(100); setStep("done");
    } catch(e) { setErrorMsg(e.message||"API 호출 실패"); setStep("error"); }
  }

  const summary = routes.length ? {
    avgGap:  Math.round(routes.reduce((s,r)=>s+r.gap,0)/routes.length),
    avgDet:  (routes.reduce((s,r)=>s+r.detour,0)/routes.length).toFixed(1),
    high:    routes.filter(r=>r.score>=70).length,
    total:   routes.length,
  } : null;

  const FILTERS=[{id:"all",l:"전체"},{id:"gap",l:"배차공백"},{id:"detour",l:"우회"},{id:"overlap",l:"노선중복"}];

  // 입력 화면
  if(step==="input") return (
    <div style={{minHeight:480,display:"flex",alignItems:"center",justifyContent:"center",padding:"2rem"}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{fontSize:22,fontWeight:500,marginBottom:4}}>왜 안 와? <span style={{color:"#E24B4A"}}>군산버스</span></div>
        <div style={{fontSize:13,color:"var(--color-text-secondary)",marginBottom:"1.5rem"}}>TAGO 공공데이터 기반 버스 불편 분석</div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>도시코드</label>
          <input value={cityCode} onChange={e=>setCityCode(e.target.value)} placeholder="37050 (군산)" style={{width:160}}/>
        </div>
        <button onClick={loadData} style={{width:"100%",padding:"10px",fontSize:14,cursor:"pointer"}}>
          데이터 불러오기 →
        </button>
        <div style={{marginTop:14,padding:"10px 12px",background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.7}}>
          백엔드 서버(<code>main.py</code>)가 실행 중이어야 합니다.<br/>
          인증키는 서버에 저장되어 있어 모바일에서도 동작합니다.
        </div>
      </div>
    </div>
  );

  // 로딩
  if(step==="loading") return (
    <div style={{minHeight:400,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:"2rem"}}>
      <div style={{fontSize:15,fontWeight:500}}>{loadMsg}</div>
      <div style={{width:"100%",maxWidth:360,height:6,background:"var(--color-border-tertiary)",borderRadius:3}}>
        <div style={{height:"100%",width:`${loadPct}%`,background:"#E24B4A",borderRadius:3,transition:"width 0.4s"}}/>
      </div>
      <div style={{fontSize:12,color:"var(--color-text-secondary)"}}>{loadPct}%</div>
    </div>
  );

  // 에러
  if(step==="error") return (
    <div style={{minHeight:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"2rem"}}>
      <div style={{fontSize:13,color:"#A32D2D",background:"#FCEBEB",padding:"12px 16px",borderRadius:"var(--border-radius-md)",maxWidth:400}}>
        <strong>오류:</strong> {errorMsg}
      </div>
      <button onClick={()=>setStep("input")} style={{cursor:"pointer"}}>← 다시 시도</button>
    </div>
  );

  // 대시보드
  return (
    <div style={{fontFamily:"var(--font-sans)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:15,fontWeight:500}}>왜 안 와? <span style={{color:"#E24B4A"}}>군산버스</span></div>
          <div style={{fontSize:11,background:"#EAF3DE",color:"#3B6D11",padding:"2px 8px",borderRadius:"var(--border-radius-md)"}}>실데이터</div>
          <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{routes.length}개 노선</div>
        </div>
        <div style={{display:"flex",gap:5}}>
          {FILTERS.map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)} style={{fontSize:11,padding:"3px 9px",borderRadius:20,cursor:"pointer",
              background:filter===f.id?"#E24B4A":"var(--color-background-primary)",
              color:filter===f.id?"#fff":"var(--color-text-secondary)",
              border:`0.5px solid ${filter===f.id?"#E24B4A":"var(--color-border-secondary)"}`}}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:"flex",height:560}}>
        <div style={{flex:1,background:"#f0ede8",position:"relative",overflow:"hidden"}}>
          <MapCanvas routes={routes} selectedId={selectedId} onSelect={setSelectedId} filter={filter}/>
          {sel&&(
            <div style={{position:"absolute",bottom:12,left:12,background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-secondary)",borderRadius:"var(--border-radius-lg)",padding:"10px 12px",minWidth:200,maxWidth:260}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:14,fontWeight:500}}>{sel.routeno}번</div>
                  <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{sel.startnodenm} → {sel.endnodenm}</div>
                </div>
                <span style={{fontSize:10,padding:"2px 6px",borderRadius:10,fontWeight:500,background:scoreBg(sel.score).bg,color:scoreBg(sel.score).c}}>
                  {scoreLabel(sel.score)}
                </span>
              </div>
              {[["배차간격",`${sel.gap}분`],["우회도",sel.detour.toFixed(1)],["노선중복",`${sel.overlapPct}%`],
                ["불편도",`${sel.score}점`],["첫/막차",`${sel.startvehicletime}/${sel.endvehicletime}`],
                ["정류장수",`${sel.stops.length}개`]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                  <span style={{color:"var(--color-text-secondary)"}}>{k}</span>
                  <span style={{fontWeight:500}}>{v}</span>
                </div>
              ))}
              <div style={{height:4,background:"var(--color-border-tertiary)",borderRadius:2,marginTop:8}}>
                <div style={{height:"100%",width:`${sel.score}%`,background:scoreColor(sel.score),borderRadius:2}}/>
              </div>
              <button onClick={()=>setSelectedId(null)} style={{marginTop:8,width:"100%",fontSize:11,padding:"4px",cursor:"pointer"}}>닫기</button>
            </div>
          )}
        </div>

        <div style={{width:210,borderLeft:"0.5px solid var(--color-border-tertiary)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {summary&&(
            <div style={{padding:"12px 12px 8px",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
              <div style={{fontSize:10,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>군산 전체 현황</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[["평균배차",`${summary.avgGap}분`],["평균우회",summary.avgDet],["불편높음",`${summary.high}개`],["분석노선",`${summary.total}개`]].map(([k,v])=>(
                  <div key={k} style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:"7px 8px"}}>
                    <div style={{fontSize:16,fontWeight:500}}>{v}</div>
                    <div style={{fontSize:10,color:"var(--color-text-secondary)",marginTop:1}}>{k}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{padding:"8px 12px",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
            {[["#E24B4A","불편 높음 (≥70)"],["#EF9F27","주의 (45~69)"],["#639922","양호 (<45)"]].map(([c,l])=>(
              <div key={l} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0}}/>
                <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
            <div style={{fontSize:10,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>노선 목록 (불편도순)</div>
            {routes.filter(r=>{
              if(filter==="gap")     return r.gap>=30;
              if(filter==="detour")  return r.detour>=1.5;
              if(filter==="overlap") return r.overlapPct>=40;
              return true;
            }).map(r=>{
              const sb=scoreBg(r.score), sel2=r.id===selectedId;
              return (
                <div key={r.id} onClick={()=>setSelectedId(sel2?null:r.id)}
                  style={{padding:"7px 9px",borderRadius:"var(--border-radius-md)",marginBottom:5,cursor:"pointer",
                    border:`0.5px solid ${sel2?"var(--color-border-secondary)":"var(--color-border-tertiary)"}`,
                    background:sel2?"var(--color-background-secondary)":"var(--color-background-primary)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:13,fontWeight:500}}>{r.routeno}번</span>
                    <span style={{fontSize:10,padding:"1px 5px",borderRadius:8,fontWeight:500,background:sb.bg,color:sb.c}}>{scoreLabel(r.score)}</span>
                  </div>
                  <div style={{fontSize:10,color:"var(--color-text-secondary)",marginBottom:4}}>{r.startnodenm} → {r.endnodenm}</div>
                  <div style={{display:"flex",gap:8,fontSize:10,color:"var(--color-text-secondary)"}}>
                    <span>{r.gap}분</span><span>우회{r.detour.toFixed(1)}</span><span>중복{r.overlapPct}%</span>
                  </div>
                  <div style={{height:3,background:"var(--color-border-tertiary)",borderRadius:2,marginTop:5}}>
                    <div style={{height:"100%",width:`${r.score}%`,background:scoreColor(r.score),borderRadius:2}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
