# 왜 안 와? 군산버스 — CLAUDE.md

## 프로젝트 개요

**대회:** 2026년 전북특별자치도 공공데이터·AI 활용 창업경진대회 (접수 마감: 2026-07-03)
**공모 부문:** 제품 및 서비스 개발 (MVP 미완성 시 아이디어 기획 부문 전환 가능)
**한 줄 정의:** 군산 시내버스의 배차 공백·노선 중복·우회 경로를 공공데이터와 AI로 진단하고, 노선 개편 효과를 시민이 직접 비교해볼 수 있는 웹 시뮬레이터

## 디렉터리 구조

```
database_project/
├── CLAUDE.md
└── files/
    ├── main.py            # FastAPI 백엔드 (TAGO API 프록시)
    ├── GunsanBusMap.jsx   # React 프론트엔드 (캔버스 지도 + 대시보드)
    └── requirements.txt   # Python 의존성
```

> 프론트엔드 프로젝트 루트(package.json, vite.config 등)는 아직 생성 전. 새 파일 추가 시 `files/` 아래에 위치시키거나 별도 `frontend/` 디렉터리를 만든다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Python, FastAPI, uvicorn, httpx |
| 프론트엔드 | React (JSX), HTML5 Canvas |
| 데이터 처리 | Python, Pandas, GeoPandas, Shapely |
| AI 분석 | scikit-learn (K-means, DBSCAN, Isolation Forest) |
| 지도 시각화 | Folium, Leaflet.js / 현재 Canvas 직접 구현 |
| 배포 | 백엔드: Render, 프론트엔드: Vercel |

## 실행 방법

### 백엔드

```bash
pip install -r files/requirements.txt
uvicorn files.main:app --reload --port 8000
```

백엔드는 `http://localhost:8000`에서 실행된다. TAGO API 인증키는 `files/main.py` 내 `SERVICE_KEY` 변수에 하드코딩되어 있다.

### 프론트엔드

`GunsanBusMap.jsx`는 Vite + React 프로젝트에 컴포넌트로 포함시킨다. 백엔드 URL은 환경변수 `VITE_API_BASE`로 주입하며 기본값은 `http://localhost:8000`.

## API 엔드포인트 (백엔드)

| 엔드포인트 | 설명 | 주요 파라미터 |
|-----------|------|--------------|
| `GET /api/routes` | 노선 목록 | `cityCode` (군산: `35020`) |
| `GET /api/route-info` | 노선 상세 (배차간격) | `cityCode`, `routeId` |
| `GET /api/route-stops` | 노선별 경유 정류장 (GPS 포함) | `cityCode`, `routeId` |
| `GET /api/stops` | 정류장 목록 | `cityCode`, `nodeNm` |
| `GET /api/city-codes` | 도시코드 전체 조회 | — |

모든 엔드포인트는 TAGO XML을 그대로 `{"xml": "..."}` 형태로 반환한다.

## 도시코드

| 도시 | 코드 |
|------|------|
| 군산 (핵심) | 37050 |
| 전주 (비교 기준) | 37070 |
| 익산 (유사 규모 비교) | 37040 |
| 김제 (농촌형 비교) | 37060 |

## 핵심 분석 지표 (프론트엔드 구현)

| 지표 | 계산 방법 | 구현 위치 |
|------|----------|----------|
| 배차공백도 (`gap`) | `intervaltime` 필드 (분) | `GunsanBusMap.jsx` |
| 우회도 (`detour`) | 실제 경로 거리 / 직선 거리 (Haversine) | `calcDetour()` |
| 노선중복도 (`overlapPct`) | 타 노선과 겹치는 정류장 수 / 전체 정류장 수 × 100 | `calcOverlap()` |
| 불편도 (`score`) | `gap/60*100 × 0.5 + (detour-1)/1.5*100 × 0.3 + overlap × 0.2` | `calcScore()` |

불편도 기준: 70 이상 = 불편 높음(빨강), 45~69 = 주의(노랑), 45 미만 = 양호(초록)

## 주요 개발 규칙

- **API 키 노출 금지:** `SERVICE_KEY`는 반드시 백엔드(`main.py`)에만 둔다. 프론트엔드에 직접 넣지 않는다.
- **XML 파싱:** TAGO API는 XML 반환. 파싱은 프론트의 `parseItems()` / `parseTotal()` 함수로 처리한다.
- **시뮬레이션 한계 명시:** 노선 분리 시뮬레이터 결과에는 반드시 "공개 데이터 기반 사전 시뮬레이션이며 실제 개편 확정안이 아님" 문구를 포함한다.
- **수요 단정 금지:** 승하차 OD 데이터는 비공개. 분석은 노선 구조·배차·접근성 지표에만 근거한다.
- **현재 MVP 범위:** 상위 20개 노선만 분석 (API 호출 비용 절감). 전체 노선 확장은 추후 고도화.

## MVP 목표 기능 (우선순위순)

1. [미완] 군산 노선 불편도 지도 (Canvas 기반)
2. [미완] 노선 목록 (불편도순 정렬) + 노선 상세 팝업
3. [미완] 배차공백 / 우회 / 노선중복 필터
4. [미완] 인근 도시(전주·익산·김제) 비교 대시보드
5. [미완] 노선 분리 시뮬레이터
6. [미완] 자동 분석 리포트 (AI 설명 생성)

## 경쟁 심사 가점 전략

- **전북 공공데이터 활용 가점(5점):** 군산·전주·익산·김제 버스 데이터 + 전북 인구·시설 데이터 활용으로 충족
- **전북 소재 대학 재학생 가점(5점):** 국립군산대학교 재학생 참여 시 충족
- **기상기후 데이터 특별상:** 선택적 확장 (폭우·폭염 시 정류장 대기 불편 분석)

## 참고 데이터 출처

| 데이터 | 출처 |
|--------|------|
| TAGO 버스노선·정류장 | 공공데이터포털 (data.go.kr) |
| 군산 버스정보 안내기 현황 | 공공데이터포털 |
| 군산 시내버스 노선 빅데이터 분석 결과 | 군산시 공공빅데이터 포털 (2024년 보고서) |
| 전주시 실시간 운행정보 | 공공데이터포털 / 전주시 교통정보센터 |
| 행정안전부 주민등록 인구통계 | data.go.kr |
| 행정구역 경계 공간데이터 | SGIS / VWorld |
