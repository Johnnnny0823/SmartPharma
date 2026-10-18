import urllib.request
import json

urls = [
    "https://od.cdc.gov.tw/eic/Dengue_Daily_NTD.json",
    "https://od.cdc.gov.tw/eic/Age_County_Gender_19CoV.json",
    "https://od.cdc.gov.tw/eic/Weekly_Age_County_Gender_044.json",
    "https://od.cdc.gov.tw/eic/Age_County_Gender_061.json" # Dengue total
]

for url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            print(f"SUCCESS: {url}")
            print(f"Total records: {len(data)}")
            if len(data) > 0:
                print("Sample record:", data[0])
            print("-" * 40)
            break
    except Exception as e:
        print(f"FAILED: {url} - {e}")
