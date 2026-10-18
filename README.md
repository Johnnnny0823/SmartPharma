# Pharmacy

偏鄉智慧藥局 - 雙向調撥與永續金流平台 (PoC)

## 專案功能
* 整合 CDC 與 CWA 資料進行智慧庫存預測與調撥
* 民眾線上慢箋預約
* 跨店庫存追蹤與 HIS 預警系統
* 數位稽核軌跡與物流車隊運輸追蹤
# smatpharmer1

## 疾管署季節性疾病資料（ETL）

管理者後台的「疾管署季節性疾病與用藥分佈預測線圖」使用疾管署開放資料：

```bash
pip install truststore              # 第一次執行前安裝：od.cdc.gov.tw 憑證鏈不完整，需改用系統憑證庫
python fetch_cdc_data.py            # 下載流感、腸病毒、腹瀉的健保就診人次週資料並寫入 database.sqlite
python fetch_cdc_data.py --offline  # 不連網，用 cdc_raw/ 上次下載的原始檔重建
node server.js                      # 啟動後，以管理者登入即可在圖表切換縣市與指標
```

- **Extract**：下載疾管署 JSON，原始檔快取在 `cdc_raw/`
- **Transform**：依「疾病 × 年 × 月 × 縣市」彙整就診人次，週資料自動換算成月份，「臺/台」統一
- **Load**：以參數化查詢寫入 SQLite `disease_monthly` 資料表（每個疾病以交易整批更新）
- API：`GET /api/disease-seasonal?county=桃園市` 回傳最近 5 個完整年度的每月平均就診人次與占全年比例
- 尚未執行過 `fetch_cdc_data.py` 時，圖表會顯示示意資料並註明
