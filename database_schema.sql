CREATE DATABASE IF NOT EXISTS smart_pharma_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_pharma_db;

-- ==========================================
-- 1. 站點與使用者資料表 (Users & Stations)
-- 納入桃園市復興區與大溪區的特約藥局、衛生所與診所，含詳細營業時間
-- ==========================================
CREATE TABLE stations (
    station_code VARCHAR(15) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    address VARCHAR(150) NOT NULL,
    latitude DECIMAL(10, 6) COMMENT 'GPS緯度',
    longitude DECIMAL(10, 6) COMMENT 'GPS經度',
    operating_hours VARCHAR(100) COMMENT '機構營業時間',
    phone VARCHAR(20) COMMENT '聯絡電話',
    station_type ENUM('Mothership', 'Frontline', 'Logistics', 'HQ') COMMENT '據點類型：Mothership(大溪補給母艦), Frontline(復興前線據點)'
);

INSERT INTO stations (station_code, name, address, latitude, longitude, operating_hours, phone, station_type) VALUES 
('HQ', '桃園市衛生局', '桃園市桃園區縣府路55號', 24.9936, 121.3010, '08:00-17:00 (週末休)', '03-3340935', 'HQ'),
-- 復興區 (Fuxing) 據點
('DEYI', '德怡藥局', '桃園市復興區澤仁里忠孝路34號', 24.8210, 121.3526, '08:30-18:30 (週日休)', '(03) 382-1686', 'Frontline'),
('FUXING_HC', '復興區衛生所', '桃園市復興區澤仁里中正路25號', 24.8213, 121.3524, '08:00-17:00 (週末休診)', '(03) 382-2325', 'Frontline'),
('KAO_CLINIC', '高揚威家醫科診所', '桃園市復興區澤仁里忠孝路32號', 24.8209, 121.3525, '08:00-17:00 (週末休診)', '(03) 382-1688', 'Frontline'),
-- 大溪區 (Daxi) 據點
('SHISHENG_FX', '新資生連鎖藥局 (復興店)', '桃園市大溪區復興路96號', 24.8809, 121.2890, '08:00-22:00 (全年無休)', '(03) 388-2206', 'Mothership'),
('GREAT_TREE', '大樹連鎖藥局 (大溪康莊店)', '桃園市大溪區康莊路160號', 24.8801, 121.2872, '08:00-22:00 (全年無休)', '(03) 387-3873', 'Mothership'),
('SHISHENG_KZ', '新資生連鎖藥局 (康莊店)', '桃園市大溪區康莊路132號', 24.8812, 121.2876, '08:00-22:00 (全年無休)', '(03) 388-2276', 'Mothership'),
('ZISHENG', '資生大藥局', '桃園市大溪區復興路92-1號', 24.8810, 121.2889, '08:00-21:30 (全年無休)', '(03) 388-2026', 'Mothership'),
-- 物流車輛
('TRUCK', '大溪-復興聯合調撥專車', '路線：巡迴大溪及復興藥局', NULL, NULL, '08:00-20:00 (機動派發)', '0912-345-678', 'Logistics');

CREATE TABLE users (
    user_id VARCHAR(30) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    station_code VARCHAR(15),
    display_name VARCHAR(50) NOT NULL,
    FOREIGN KEY (station_code) REFERENCES stations(station_code)
);

INSERT INTO users (user_id, password_hash, role, station_code, display_name) VALUES 
('admin', '123', 'admin', 'HQ', '桃園市衛生局管理者'),
('deyi_wang', '123', 'pharmacist', 'DEYI', '德怡藥局值班藥師'),
('fuxing_chen', '123', 'pharmacist', 'FUXING_HC', '復興區衛生所主任'),
('daxi_lin', '123', 'pharmacist', 'SHISHENG_FX', '新資生復興店值班藥師'),
('driver', '123', 'driver', 'TRUCK', '調撥專車司機'),
('wang', '123', 'buyer', NULL, '王大明');

-- ==========================================
-- 2. 健保藥品主檔 (Medicines)
-- 欄位格式嚴格遵循健保署 INAE3000S01 與 Health-17 規範
-- ==========================================
CREATE TABLE medicines (
    drug_code VARCHAR(10) PRIMARY KEY COMMENT '健保藥品代碼 (10碼)',
    drug_chinese_name VARCHAR(100) NOT NULL COMMENT '中文品名',
    drug_english_name VARCHAR(100) NOT NULL COMMENT '英文品名',
    dosage_form VARCHAR(50) COMMENT '劑型 (例如: 錠劑, 膠囊劑, 注射劑)',
    atc_code VARCHAR(10) COMMENT '解剖治療分類代碼 (ATC)',
    price DECIMAL(10,2) COMMENT '健保支付單價',
    single_compound_flag VARCHAR(10) COMMENT '單/複方註記',
    manufacturer VARCHAR(100) COMMENT '製造廠名稱',
    temperature_req ENUM('Room', 'Cold Chain 2-8°C', 'Frozen -20°C') DEFAULT 'Room' COMMENT '物流溫控條件',
    rx_only BOOLEAN DEFAULT TRUE COMMENT '是否為處方藥'
);

INSERT INTO medicines (drug_code, drug_chinese_name, drug_english_name, dosage_form, atc_code, price, single_compound_flag, manufacturer, temperature_req, rx_only) VALUES 
('A059591100', '克流感膠囊 (Tamiflu) - 流感用藥', 'Tamiflu Capsules 75mg', '膠囊劑', 'J05AH02', 950.00, '單方', 'Roche Registration Ltd.', 'Room', TRUE),
('B023245100', '普拿疼止痛錠 (Panadol) - 解熱鎮痛', 'Panadol Tablets 500mg', '錠劑', 'N02BE01', 15.00, '單方', 'GlaxoSmithKline', 'Room', FALSE),
('C054890100', '樂必寧膠囊 (Loperamide) - 腹瀉用藥', 'Loperamide Capsules 2mg', '膠囊劑', 'A07DA03', 20.00, '單方', 'Standard Chem. & Pharm.', 'Room', FALSE),
('D045980100', '伊普芬液 (Ibuprofen) - 兒童退燒', 'Ibuprofen Oral Suspension', '口服液劑', 'M01AE01', 120.00, '單方', 'Synmosa Biopharma', 'Room', FALSE),
('E060800100', '倍拉維 (Paxlovid) - COVID抗病毒', 'Paxlovid Film-Coated Tablets', '包衣錠劑', 'J05AE30', 20000.00, '複方', 'Pfizer Ireland Pharmaceuticals', 'Room', TRUE),
('I012345678', '胰島素注射劑 (Insulin) - 糖尿病用藥', 'Novomix 30 Flexpen', '注射劑', 'A10AD05', 800.00, '複方', 'Novo Nordisk A/S', 'Cold Chain 2-8°C', TRUE);

-- ==========================================
-- 3. 智慧庫存控制參數 (Inventory Control Parameters)
-- ==========================================
CREATE TABLE inventory_control (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(15),
    drug_code VARCHAR(10),
    safety_stock_level INT COMMENT '安全庫存量',
    safety_stock_days INT COMMENT '安全庫存天數 (大溪預設3天，復興因山地天災預設14天)',
    max_stock_level INT COMMENT '最高備貨量',
    reorder_quantity INT COMMENT '經濟調撥量',
    FOREIGN KEY (station_code) REFERENCES stations(station_code),
    FOREIGN KEY (drug_code) REFERENCES medicines(drug_code)
);

-- 大溪(母艦) 安全天數低，復興(子艦) 因聯外中斷風險，安全天數提升至 14 天
INSERT INTO inventory_control (station_code, drug_code, safety_stock_level, safety_stock_days, max_stock_level, reorder_quantity) VALUES 
('SHISHENG_FX', 'I012345678', 100, 3, 1000, 50), 
('DEYI', 'I012345678', 50, 14, 200, 10), 
('FUXING_HC', 'I012345678', 30, 14, 150, 10);

-- ==========================================
-- 4. 處方箋預約憑證與慢箋照片 (Prescriptions)
-- 民眾預約慢箋必須上傳照片作為憑證
-- ==========================================
CREATE TABLE prescriptions (
    prescription_id VARCHAR(30) PRIMARY KEY COMMENT '慢箋預約單號',
    patient_id VARCHAR(20) NOT NULL COMMENT '病患身分證字號(加密/遮罩)',
    image_base64 LONGTEXT NOT NULL COMMENT '處方箋慢箋照片 Base64 編碼',
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('待核實', '已核實核發', '核實遭退回') DEFAULT '待核實'
);

-- ==========================================
-- 5. 調撥單與車輛物流軌跡 (Transfer Requests)
-- ==========================================
CREATE TABLE transfer_requests (
    req_id VARCHAR(20) PRIMARY KEY,
    prescription_id VARCHAR(30) NULL,
    from_station VARCHAR(15),
    to_station VARCHAR(15),
    drug_code VARCHAR(10),
    qty INT,
    status_code ENUM('待審核', '已核准出庫', '專車配送中', '已送達簽收', '已退回') NOT NULL,
    logistics_condition VARCHAR(100) COMMENT '物流溫控紀錄 (如: 4.5°C冷鏈正常)',
    request_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    completion_time DATETIME NULL,
    FOREIGN KEY (from_station) REFERENCES stations(station_code),
    FOREIGN KEY (to_station) REFERENCES stations(station_code),
    FOREIGN KEY (drug_code) REFERENCES medicines(drug_code)
);

-- ==========================================
-- 6. 法定傳染病統計資料 (NIDSS Open Data)
-- 用於儲存 CDC 開放資料的傳染病確診數據
-- ==========================================
CREATE TABLE infectious_diseases_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    disease_name VARCHAR(100) NOT NULL COMMENT '疾病名稱',
    report_year INT NOT NULL COMMENT '發病年份',
    report_week INT COMMENT '發病週別',
    report_month INT COMMENT '發病月份',
    county VARCHAR(50) COMMENT '縣市別',
    gender VARCHAR(10) COMMENT '性別',
    age_group VARCHAR(50) COMMENT '年齡層',
    cases INT NOT NULL DEFAULT 0 COMMENT '確定病例數',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
    INDEX idx_disease_year (disease_name, report_year),
    INDEX idx_county (county)
);

-- ==========================================
-- 7. 氣象與災防連動資料 (CWA Weather Data)
-- 用於儲存中央氣象署各鄉鎮天氣預報及災防特報
-- ==========================================
CREATE TABLE weather_forecasts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_name VARCHAR(50) NOT NULL COMMENT '地區名稱 (如: 復興區)',
    forecast_time DATETIME NOT NULL COMMENT '預報時間區間開始',
    weather_condition VARCHAR(100) COMMENT '天氣現象 (Wx)',
    rain_probability INT COMMENT '降雨機率 PoP12h (%)',
    temperature INT COMMENT '溫度 (T)',
    hazard_alert VARCHAR(255) COMMENT '災防警報 (如果有)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
    INDEX idx_location_time (location_name, forecast_time)
);

-- ==========================================
-- 8. 庫存批號與效期管理 (Inventory Batches & Expiry)
-- 追蹤各站點的實體庫存批號，以提供過期藥品預警
-- ==========================================
CREATE TABLE inventory_batches (
    batch_id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(15) NOT NULL,
    drug_code VARCHAR(10) NOT NULL,
    batch_number VARCHAR(50) NOT NULL COMMENT '藥廠生產批號',
    quantity INT NOT NULL DEFAULT 0 COMMENT '該批號剩餘數量',
    expiration_date DATE NOT NULL COMMENT '有效期限',
    status ENUM('正常', '已過期', '已下架退回') DEFAULT '正常',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (station_code) REFERENCES stations(station_code),
    FOREIGN KEY (drug_code) REFERENCES medicines(drug_code),
    INDEX idx_expiry (expiration_date)
);

-- 插入一些模擬的庫存批號資料 (包含即將過期、已過期的資料作為示範)
INSERT INTO inventory_batches (station_code, drug_code, batch_number, quantity, expiration_date, status) VALUES 
('SHISHENG_FX', 'I012345678', 'LOT2024A1', 20, DATE_ADD(CURRENT_DATE, INTERVAL 300 DAY), '正常'),  -- 安全
('SHISHENG_FX', 'I012345678', 'LOT2024A2', 30, DATE_ADD(CURRENT_DATE, INTERVAL 60 DAY), '正常'),   -- 60天內到期 (黃燈)
('DEYI', 'I012345678', 'LOT2023X9', 15, DATE_ADD(CURRENT_DATE, INTERVAL 15 DAY), '正常'),          -- 15天內到期 (橘燈/危險)
('DEYI', 'B023245100', 'PAN202301', 5, DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY), '已過期'),         -- 已過期 (紅燈)
('FUXING_HC', 'A059591100', 'TAM2024', 10, DATE_ADD(CURRENT_DATE, INTERVAL 85 DAY), '正常');       -- 90天內到期 (黃燈)
