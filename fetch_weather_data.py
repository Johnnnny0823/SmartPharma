import urllib.request
import json
import urllib.parse
from datetime import datetime

# ==========================================
# 請在此填入您的中央氣象署 API 授權碼
# 申請網址: https://opendata.cwa.gov.tw/index
# ==========================================
CWA_API_KEY = "YOUR_CWA_API_KEY_HERE"

# 鄉鎮天氣預報 - 桃園市未來一週天氣預報 (F-D0047-007)
LOCATION_NAME = "復興區"
URL = f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-007?Authorization={CWA_API_KEY}&format=JSON&locationName={urllib.parse.quote(LOCATION_NAME)}"

SQL_FILE = "weather_data.sql"

def fetch_weather_data():
    if CWA_API_KEY == "YOUR_CWA_API_KEY_HERE":
        print("⚠️ 請先將您的 API 授權碼填寫至 CWA_API_KEY 變數中，再執行此腳本。")
        return None

    print(f"正在抓取氣象資料: {LOCATION_NAME}")
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            raw_data = response.read().decode('utf-8')
            return json.loads(raw_data)
    except Exception as e:
        print(f"抓取氣象資料失敗: {e}")
        return None

def generate_sql():
    data = fetch_weather_data()
    if not data:
        return

    try:
        # CWA API JSON 結構解析
        locations = data.get("records", {}).get("locations", [])
        if not locations:
            print("找不到對應的 locations 資料")
            return
            
        target_location = locations[0].get("location", [])
        if not target_location:
            print("找不到對應的 location 資料")
            return
            
        weather_elements = target_location[0].get("weatherElement", [])
        
        # 整理各時間區段的氣象資料
        # Wx: 天氣現象, PoP12h: 12小時降雨機率, T: 溫度
        forecasts = {}
        
        for element in weather_elements:
            element_name = element.get("elementName")
            times = element.get("time", [])
            for t in times:
                start_time = t.get("startTime")
                if start_time not in forecasts:
                    forecasts[start_time] = {
                        "weather_condition": "",
                        "rain_probability": "NULL",
                        "temperature": "NULL",
                        "hazard_alert": "無" # 預設無警報
                    }
                
                # 取得數值
                element_value = t.get("elementValue", [])
                val = element_value[0].get("value", "") if element_value else ""
                
                if element_name == "Wx":
                    forecasts[start_time]["weather_condition"] = val
                elif element_name == "PoP12h":
                    # 降雨機率可能是空值
                    forecasts[start_time]["rain_probability"] = val if val.isdigit() else "NULL"
                elif element_name == "T":
                    forecasts[start_time]["temperature"] = val if val.replace('-', '').isdigit() else "NULL"

        # 寫入 SQL 檔案
        with open(SQL_FILE, 'w', encoding='utf-8') as f:
            f.write("-- CWA 氣象資料爬蟲產生的 SQL 檔\n")
            f.write("USE smart_pharma_db;\n\n")
            
            # 清空舊有針對該地區未來的預報資料 (可選)
            # f.write(f"DELETE FROM weather_forecasts WHERE location_name = '{LOCATION_NAME}';\n\n")
            
            for start_time, f_data in forecasts.items():
                wx = f_data["weather_condition"].replace("'", "''")
                pop = f_data["rain_probability"]
                temp = f_data["temperature"]
                alert = f_data["hazard_alert"].replace("'", "''")
                
                sql = f"INSERT INTO weather_forecasts " \
                      f"(location_name, forecast_time, weather_condition, rain_probability, temperature, hazard_alert) " \
                      f"VALUES ('{LOCATION_NAME}', '{start_time}', '{wx}', {pop}, {temp}, '{alert}');\n"
                f.write(sql)
                
        print(f"✅ 氣象資料爬蟲執行完畢！SQL 指令已儲存至 {SQL_FILE}")
        print("您可使用： mysql -u root -p smart_pharma_db < weather_data.sql 匯入")

    except Exception as e:
        print(f"解析 JSON 過程發生錯誤: {e}")

if __name__ == "__main__":
    generate_sql()
