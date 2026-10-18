"""
疾管署 (Taiwan CDC) 開放資料 ETL
================================
Extract  : 下載疾管署開放資料平台的健保門急診就診人次 JSON（完整歷史資料）
Transform: 依「疾病 x 年 x 月 x 縣市」彙整就診人次（週資料自動換算成月份）
Load     : 寫入 SQLite (database.sqlite) 的 disease_monthly 資料表

前端「季節性疾病與用藥分佈」折線圖會透過 /api/disease-seasonal 讀取這張表，
算出各疾病每個月的平均就診人次與占全年比例，用來判斷哪個季節該提前備哪種藥。

用法：
    python fetch_cdc_data.py            # 線上抓取並寫入資料庫
    python fetch_cdc_data.py --offline  # 不連網，用 cdc_raw/ 裡上次下載的檔案重建
    python fetch_cdc_data.py --show-fields  # 只印出每個資料集的欄位，方便除錯
"""

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.request
from collections import defaultdict

try:
    # od.cdc.gov.tw 沒送完整中繼憑證，Python 內建驗證會失敗；
    # truststore 改用 Windows/macOS 系統憑證庫（會自動補抓中繼憑證）
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.sqlite")
RAW_DIR = os.path.join(BASE_DIR, "cdc_raw")

# 每個疾病可以列多個候選網址，依序嘗試，第一個成功的就採用
# 註：疾管署已下架「地區年齡性別統計表」(Age_County_Gender_*.json) 確定病例資料，
#     改用仍持續更新的「健保門急診就診人次」週資料（2016 起，分縣市），數值為就診人次
DATASETS = [
    {
        "code": "flu",
        "name": "流感",
        "drug": "克流感膠囊",
        "case_key": "流感及其所致肺炎健保就診人次",
        "urls": ["https://od.cdc.gov.tw/eic/NHI_Influenza.json"],
    },
    {
        "code": "ev",
        "name": "腸病毒",
        "drug": "退燒糖漿",
        "case_key": "腸病毒健保就診人次",
        "urls": ["https://od.cdc.gov.tw/eic/NHI_EnteroviralInfection.json"],
    },
    {
        "code": "diarrhea",
        "name": "腹瀉",
        "drug": "樂必寧膠囊",
        "case_key": "腹瀉健保就診人次",
        "urls": ["https://od.cdc.gov.tw/eic/NHI_Diarrhea.json"],
    },
]

# 不同資料集的欄位名稱略有差異，依序找第一個存在的欄位
YEAR_KEYS = ["年", "發病年份", "診斷年份", "個案研判日年份", "年份"]
MONTH_KEYS = ["發病月份", "診斷月份", "個案研判日月份", "月份"]
WEEK_KEYS = ["週", "發病週別", "診斷週別", "個案研判日週別", "週別"]
COUNTY_KEYS = ["縣市", "居住縣市"]
CASE_KEYS = ["確定病例數", "病例數"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS disease_monthly (
    disease_code TEXT    NOT NULL,
    disease_name TEXT    NOT NULL,
    drug_hint    TEXT,
    year         INTEGER NOT NULL,
    month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    county       TEXT    NOT NULL,
    cases        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (disease_code, year, month, county)
);
CREATE INDEX IF NOT EXISTS idx_disease_monthly_county ON disease_monthly (county);

CREATE TABLE IF NOT EXISTS cdc_fetch_log (
    disease_code TEXT PRIMARY KEY,
    source_url   TEXT,
    raw_records  INTEGER,
    agg_rows     INTEGER,
    year_min     INTEGER,
    year_max     INTEGER,
    fetched_at   TEXT
);
"""


# ---------------------------------------------------------------- Extract
def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8-sig"))  # 去除 BOM


def extract(ds, offline):
    """回傳 (records, source)。線上成功時會把原始 JSON 存到 cdc_raw/ 當快取。"""
    cache = os.path.join(RAW_DIR, f"{ds['code']}.json")
    if not offline:
        for url in ds["urls"]:
            try:
                print(f"  下載 {url}")
                data = download(url)
                if isinstance(data, list) and data:
                    os.makedirs(RAW_DIR, exist_ok=True)
                    with open(cache, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False)
                    return data, url
                print("    回傳內容不是資料陣列，改試下一個網址")
            except Exception as e:  # 網路錯誤、404、JSON 格式錯誤
                print(f"    失敗：{e}")
        print("  所有網址都失敗，改用本機快取")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f), f"cache:{cache}"
    return [], None


# -------------------------------------------------------------- Transform
def pick(rec, keys):
    for k in keys:
        if k in rec and str(rec[k]).strip() != "":
            return rec[k]
    return None


def to_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def week_to_month(year, week):
    """ISO 週別換算月份（取該週的星期四所在月份）"""
    try:
        return dt.date.fromisocalendar(year, min(max(week, 1), 53), 4).month
    except ValueError:
        # 疾管署採流行病學週（週日起算），部分年份有第 53 週但 ISO 週曆沒有，視為年底
        return 12 if week >= 53 else None


def normalize_county(name):
    name = str(name or "").strip().replace("臺", "台")
    return name or "未知"


def transform(records, case_keys=CASE_KEYS):
    """把逐筆個案資料彙整成 {(year, month, county): cases}，並回報略過幾筆。"""
    agg = defaultdict(int)
    skipped = 0
    for rec in records:
        year = to_int(pick(rec, YEAR_KEYS))
        month = to_int(pick(rec, MONTH_KEYS))
        if (month is None or month == 0) and year:
            week = to_int(pick(rec, WEEK_KEYS))
            month = week_to_month(year, week) if week else None
        cases = to_int(pick(rec, case_keys))
        if cases is None:
            cases = 1  # 部分資料集一列就代表一個個案
        if not year or not month or not 1 <= month <= 12:
            skipped += 1
            continue
        agg[(year, month, normalize_county(pick(rec, COUNTY_KEYS)))] += cases
    return agg, skipped


# ------------------------------------------------------------------- Load
def load(conn, ds, agg, source, raw_count):
    rows = [
        (ds["code"], ds["name"], ds["drug"], y, m, c, n)
        for (y, m, c), n in sorted(agg.items())
    ]
    years = [y for (y, _, _) in agg]
    with conn:  # 交易：失敗會整批 rollback，不會留下半套資料
        conn.execute("DELETE FROM disease_monthly WHERE disease_code = ?", (ds["code"],))
        conn.executemany(
            "INSERT INTO disease_monthly "
            "(disease_code, disease_name, drug_hint, year, month, county, cases) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.execute(
            "INSERT OR REPLACE INTO cdc_fetch_log VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ds["code"], source, raw_count, len(rows), min(years), max(years),
             dt.datetime.now().isoformat(timespec="seconds")),
        )
    return len(rows)


def peak_months(agg, top=3):
    by_month = defaultdict(int)
    for (_, m, _), n in agg.items():
        by_month[m] += n
    return [m for m, _ in sorted(by_month.items(), key=lambda kv: -kv[1])[:top]]


def main():
    # Windows 終端機預設 cp950，避免印出 ✓ ✗ 時發生編碼錯誤
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="疾管署傳染病資料 ETL → SQLite")
    ap.add_argument("--offline", action="store_true", help="只用 cdc_raw/ 快取，不連網")
    ap.add_argument("--show-fields", action="store_true", help="印出資料欄位後結束")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    ok = 0
    for ds in DATASETS:
        print(f"\n[{ds['name']}]")
        records, source = extract(ds, args.offline)
        if not records:
            print("  ✗ 沒有資料，保留資料庫中原本的內容")
            continue
        if args.show_fields:
            print("  欄位：", list(records[0].keys()))
            print("  範例：", records[-1])
            continue
        agg, skipped = transform(records, [ds["case_key"]] + CASE_KEYS)
        if not agg:
            print("  ✗ 找不到年份/月份欄位，請用 --show-fields 檢查欄位名稱")
            print("  欄位：", list(records[0].keys()))
            continue
        n = load(conn, ds, agg, source, len(records))
        years = sorted({y for (y, _, _) in agg})
        print(f"  ✓ 原始 {len(records)} 筆 → 彙整 {n} 列（{years[0]}–{years[-1]}）"
              f"，略過 {skipped} 筆；人次最多的月份：{peak_months(agg)}")
        ok += 1
    conn.close()
    print(f"\n完成：{ok}/{len(DATASETS)} 個疾病已寫入 {os.path.basename(DB_PATH)} 的 disease_monthly")
    return 0 if ok or args.show_fields else 1


if __name__ == "__main__":
    sys.exit(main())
