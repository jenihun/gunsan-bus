import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet 기본 아이콘 설정
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

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
  return parseItems(xml);
}
async function fetchRouteInfo(cityCode, routeId) {
  const xml = await api("/api/route-info", { cityCode, routeId });
  return parseItems(xml)[0] || null;
}
async function fetchRouteStops(cityCode, routeId, pageNo = 1) {
  const xml = await api("/api/route-stops", { cityCode, routeId, numOfRows: 200, pageNo });
  return parseItems(xml);
}

// ── 분석 함수
function calcDetour(stopsDirObj) {
  const stops = stopsDirObj?.up || stopsDirObj?.down || [];
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
  const targetStops = (allStops[targetId]?.up || []).concat(allStops[targetId]?.down || []);
  const ids=new Set(targetStops.map(s=>s.id));
  if(!ids.size) return 0;
  let n=0;
  Object.entries(allStops).forEach(([rid,dirObj])=>{
    if(rid!==targetId) {
      const stops = (dirObj?.up || []).concat(dirObj?.down || []);
      stops.forEach(s=>{ if(ids.has(s.id)) n++; });
    }
  });
  return Math.min(100,Math.round((n/ids.size)*100));
}
function calcScore(gap,detour,overlap) {
  return Math.round(Math.min(100,gap/60*100)*0.5+Math.min(100,(detour-1)/1.5*100)*0.3+overlap*0.2);
}
const scoreColor = s => s>=70?"#E24B4A":s>=45?"#EF9F27":"#639922";
const scoreLabel = s => s>=70?"불편 높음":s>=45?"주의":"양호";
const scoreBg    = s => s>=70?{bg:"#FCEBEB",c:"#A32D2D"}:s>=45?{bg:"#FAEEDA",c:"#854F0B"}:{bg:"#EAF3DE",c:"#3B6D11"};

// ── 지도 컴포넌트 (OpenStreetMap + Leaflet)
function MapComponent({ routes, selectedId, onSelect, filter }) {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);

  const vis = routes.filter(r => {
    if (filter === "gap") return r.gap >= 30;
    if (filter === "detour") return r.detour >= 1.5;
    if (filter === "overlap") return r.overlapPct >= 40;
    return true;
  });

  return (
    <MapContainer
      center={[35.965, 126.6]}
      zoom={13}
      style={{ height: "100%", width: "100%" }}
      ref={mapRef}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />

      {vis.map(r => (
        <div key={r.id}>
          {r.stops?.up && r.stops.up.length >= 2 && (
            <Polyline
              positions={r.stops.up.map(s => [s.lat, s.lon])}
              color={scoreColor(r.score)}
              weight={r.id === selectedId ? 4 : 2.5}
              opacity={selectedId && r.id !== selectedId ? 0.3 : 0.8}
              eventHandlers={{ click: () => onSelect(r.id === selectedId ? null : r.id) }}
            >
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <strong>{r.routeno}번</strong><br/>
                  {r.startnodenm} → {r.endnodenm}<br/>
                  불편도: {r.score}점 ({scoreLabel(r.score)})
                </div>
              </Popup>
            </Polyline>
          )}

          {r.stops?.down && r.stops.down.length >= 2 && (
            <Polyline
              positions={r.stops.down.map(s => [s.lat, s.lon])}
              color={scoreColor(r.score)}
              weight={r.id === selectedId ? 4 : 2.5}
              opacity={selectedId && r.id !== selectedId ? 0.3 : 0.8}
              dashArray="5,5"
              eventHandlers={{ click: () => onSelect(r.id === selectedId ? null : r.id) }}
            >
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <strong>{r.routeno}번 (귀로)</strong><br/>
                  불편도: {r.score}점 ({scoreLabel(r.score)})
                </div>
              </Popup>
            </Polyline>
          )}

          {(r.stops?.up || []).map(s => (
            <CircleMarker
              key={s.id + "u"}
              center={[s.lat, s.lon]}
              radius={r.id === selectedId ? 4 : 2.5}
              fill={true}
              fillColor="#fff"
              fillOpacity={1}
              color={scoreColor(r.score)}
              weight={r.id === selectedId ? 2 : 1}
              opacity={selectedId && r.id !== selectedId ? 0.3 : 1}
            >
              <Popup>{s.name}</Popup>
            </CircleMarker>
          ))}

          {(r.stops?.down || []).map(s => (
            <CircleMarker
              key={s.id + "d"}
              center={[s.lat, s.lon]}
              radius={r.id === selectedId ? 4 : 2.5}
              fill={true}
              fillColor="#fff"
              fillOpacity={1}
              color={scoreColor(r.score)}
              weight={r.id === selectedId ? 2 : 1}
              opacity={selectedId && r.id !== selectedId ? 0.3 : 1}
            >
              <Popup>{s.name} (귀로)</Popup>
            </CircleMarker>
          ))}
        </div>
      ))}
    </MapContainer>
  );
}

// ── 메인 앱
export default function App() {
  const [cityCode, setCityCode]   = useState("35020");
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
      const routeItems=await fetchRouteList(cityCode);
      if(!routeItems.length) throw new Error("노선 없음 — 도시코드 확인 필요 (군산: 35020)");
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
        const items=await fetchRouteStops(cityCode,details[i].routeid);
        const stopsWithDir=items
          .map(s=>({id:s.nodeid,name:s.nodenm,lat:parseFloat(s.gpslati),lon:parseFloat(s.gpslong),seq:parseInt(s.nodeord),dir:parseInt(s.updowncd)||0}))
          .filter(s=>!isNaN(s.lat)&&!isNaN(s.lon));

        // 상행/하행 분리
        const up=stopsWithDir.filter(s=>s.dir===0).sort((a,b)=>a.seq-b.seq);
        const down=stopsWithDir.filter(s=>s.dir===1).sort((a,b)=>a.seq-b.seq);
        allStops[details[i].routeid]={up,down};
        setLoadPct(50+Math.round(i/details.length*40));
      }

      setLoadMsg("불편 지표 계산 중...");
      const processed=details.map(r=>{
        const stops=allStops[r.routeid]||[];
        const gap=60; // 배차간격 데이터는 추후 연동
        const detour=calcDetour(stops);
        const overlapPct=calcOverlap(allStops,r.routeid);
        const score=calcScore(gap,detour,overlapPct);
        return { id:r.routeid, routeno:r.routeno||r.routeid, routetp:r.routetp||"",
          startnodenm:r.startnodenm||"", endnodenm:r.endnodenm||"",
          startvehicletime:r.startvehicletime||"미정", endvehicletime:r.endvehicletime||"미정",
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
          <input value={cityCode} onChange={e=>setCityCode(e.target.value)} placeholder="35020 (군산)" style={{width:160}}/>
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
          <MapComponent routes={routes} selectedId={selectedId} onSelect={setSelectedId} filter={filter}/>
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
                ["정류장수",`${((sel.stops?.up?.length||0)+(sel.stops?.down?.length||0))}개`]].map(([k,v])=>(
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
