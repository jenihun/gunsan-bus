from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

SERVICE_KEY = os.environ["TAGO_SERVICE_KEY"]

ROUTE_BASE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService"
STOP_BASE  = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService"

async def tago_get(url: str, params: dict) -> str:
    params["serviceKey"] = SERVICE_KEY
    params["_type"] = "xml"
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.text

# 1. 노선번호 목록
@app.get("/api/routes")
async def get_routes(cityCode: str = "35020", numOfRows: int = 100, pageNo: int = 1):
    xml = await tago_get(f"{ROUTE_BASE}/getRouteNoList", {
        "cityCode": cityCode, "numOfRows": numOfRows, "pageNo": pageNo
    })
    return {"xml": xml}

# 2. 노선 상세정보 (배차간격)
@app.get("/api/route-info")
async def get_route_info(cityCode: str = "35020", routeId: str = ""):
    xml = await tago_get(f"{ROUTE_BASE}/getRouteInfoIem", {
        "cityCode": cityCode, "routeId": routeId
    })
    return {"xml": xml}

# 3. 노선별 경유 정류소 (GPS 좌표)
@app.get("/api/route-stops")
async def get_route_stops(cityCode: str = "35020", routeId: str = "", numOfRows: int = 200, pageNo: int = 1):
    xml = await tago_get(f"{ROUTE_BASE}/getRouteAcctoThrghSttnList", {
        "cityCode": cityCode, "routeId": routeId, "numOfRows": numOfRows, "pageNo": pageNo
    })
    return {"xml": xml}

# 4. 정류소 목록
@app.get("/api/stops")
async def get_stops(cityCode: str = "37050", nodeNm: str = "", numOfRows: int = 100, pageNo: int = 1):
    xml = await tago_get(f"{STOP_BASE}/getSttnNoList", {
        "cityCode": cityCode, "nodeNm": nodeNm, "numOfRows": numOfRows, "pageNo": pageNo
    })
    return {"xml": xml}

# 5. 도시코드 확인용
@app.get("/api/city-codes")
async def get_city_codes():
    xml = await tago_get(f"{ROUTE_BASE}/getCtyCodeList", {})
    return {"xml": xml}
