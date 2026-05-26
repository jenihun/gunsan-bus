import requests
import xml.etree.ElementTree as ET

API_BASE = "http://localhost:8000"

# 1. 노선 1개 가져오기
print("=" * 60)
print("1. 노선 목록 샘플")
print("=" * 60)
r = requests.get(f"{API_BASE}/api/routes", params={"cityCode": "35020", "numOfRows": 1})
xml = r.json()["xml"]
root = ET.fromstring(xml)
items = root.findall(".//item")
if items:
    print("필드명:")
    for tag in items[0]:
        print(f"  - {tag.tag}: {tag.text[:50] if tag.text else ''}")
    routeid = items[0].find("routeid").text if items[0].find("routeid") is not None else None
    print(f"\n첫 번째 routeid: {routeid}")
else:
    print("노선 데이터 없음")
    exit()

# 2. 노선 상세정보
print("\n" + "=" * 60)
print("2. 노선 상세정보")
print("=" * 60)
r = requests.get(f"{API_BASE}/api/route-info", params={"cityCode": "35020", "routeId": routeid})
xml = r.json()["xml"]
root = ET.fromstring(xml)
items = root.findall(".//item")
if items:
    print("필드명:")
    for tag in items[0]:
        print(f"  - {tag.tag}: {tag.text[:50] if tag.text else ''}")

# 3. 정류장 정보 (가장 중요!)
print("\n" + "=" * 60)
print("3. 정류장 정보 (GPS 필드 확인)")
print("=" * 60)
r = requests.get(f"{API_BASE}/api/route-stops", params={"cityCode": "35020", "routeId": routeid, "numOfRows": 3})
xml = r.json()["xml"]
root = ET.fromstring(xml)
items = root.findall(".//item")
if items:
    print(f"총 정류장 수: {len(items)}")
    print("\n첫 3개 정류장의 필드명:")
    for i, item in enumerate(items[:3]):
        print(f"\n  정류장 {i+1}:")
        for tag in item:
            val = tag.text[:80] if tag.text else ""
            print(f"    - {tag.tag}: {val}")
else:
    print("정류장 데이터 없음")
