const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./database.sqlite');

// Load mock data
const mockDataRaw = fs.readFileSync('./mock_nhi_data.json', 'utf8');
const mockData = JSON.parse(mockDataRaw);

// Add custom logic from script.js to inject extra medicines if missing
let inventoryList = mockData.inventory || [];
if (!inventoryList.some(item => item.drugCode === 'B023245199')) {
    inventoryList.push(
        { drugCode: 'B023245199', drugChineseName: '布洛芬止痛膠囊 (Ibuprofen) - 相似替代藥', drugEnglishName: 'Ibuprofen 400mg', price: 20, rxOnly: false, atcCode: 'N02BE99', dosageForm: '膠囊劑', singleCompoundFlag: '單方', manufacturer: 'AstraZeneca', temperatureReq: 'Room', expiryDays: 190, batchNo: 'B33842', stock_DEYI: 1, stock_FUXING_HC: 0, stock_KAO_CLINIC: 0, stock_SHISHENG_FX: 90, stock_GREAT_TREE: 0, stock_SHISHENG_KZ: 70, stock_ZISHENG: 50 },
        { drugCode: 'I012345699', drugChineseName: '美獲平糖適錠 (Metformin) - 糖尿病相似替代藥', drugEnglishName: 'Metformin 500mg', price: 10, rxOnly: true, atcCode: 'A10BA02', dosageForm: '錠劑', singleCompoundFlag: '單方', manufacturer: 'Sandoz', temperatureReq: 'Room', expiryDays: 160, batchNo: 'B78129', stock_DEYI: 0, stock_FUXING_HC: 2, stock_KAO_CLINIC: 0, stock_SHISHENG_FX: 0, stock_GREAT_TREE: 80, stock_SHISHENG_KZ: 60, stock_ZISHENG: 40 }
    );
}

if (!inventoryList.some(item => item.drugCode === 'A07DA03100')) {
    inventoryList.push(
        { drugCode: 'A07DA03100', drugChineseName: '樂必寧膠囊 (Loperamide) - 緩解腹瀉', drugEnglishName: 'Loperamide 2mg', price: 10, rxOnly: false, atcCode: 'A07DA03', dosageForm: '膠囊劑', singleCompoundFlag: '單方', manufacturer: 'Teva', temperatureReq: 'Room', expiryDays: 300, batchNo: 'L99821', stock_DEYI: 0, stock_SHISHENG_FX: 0, stock_GREAT_TREE: 90, stock_SHISHENG_KZ: 50, stock_ZISHENG: 40 },
        { drugCode: 'M02AA13100', drugChineseName: '伊普芬液 (Ibuprofen) - 兒童腸病毒退燒', drugEnglishName: 'Ibuprofen Suspension 20mg/ml', price: 50, rxOnly: false, atcCode: 'M02AA13', dosageForm: '口服液', singleCompoundFlag: '單方', manufacturer: 'YungShin', temperatureReq: 'Room', expiryDays: 150, batchNo: 'I22014', stock_DEYI: 1, stock_SHISHENG_FX: 40, stock_GREAT_TREE: 0, stock_SHISHENG_KZ: 30, stock_ZISHENG: 20 },
        { drugCode: 'R05DA09100', drugChineseName: '莫敵咳 (Dextromethorphan) - 鎮咳祛痰', drugEnglishName: 'Dextromethorphan 15mg', price: 12, rxOnly: false, atcCode: 'R05DA09', dosageForm: '錠劑', singleCompoundFlag: '單方', manufacturer: 'Purzer', temperatureReq: 'Room', expiryDays: 400, batchNo: 'D34521', stock_DEYI: 2, stock_SHISHENG_FX: 150, stock_GREAT_TREE: 200, stock_SHISHENG_KZ: 120, stock_ZISHENG: 80 },
        { drugCode: 'R06AB04100', drugChineseName: '敏肝寧 (Chlorpheniramine) - 抗過敏', drugEnglishName: 'Chlorpheniramine 4mg', price: 8, rxOnly: false, atcCode: 'R06AB04', dosageForm: '錠劑', singleCompoundFlag: '單方', manufacturer: 'Standard', temperatureReq: 'Room', expiryDays: 360, batchNo: 'C88732', stock_DEYI: 0, stock_SHISHENG_FX: 180, stock_GREAT_TREE: 220, stock_SHISHENG_KZ: 140, stock_ZISHENG: 90 },
        { drugCode: 'C08CA01100', drugChineseName: '脈優錠 (Amlodipine) - 高血壓用藥', drugEnglishName: 'Norvasc 5mg', price: 30, rxOnly: true, atcCode: 'C08CA01', dosageForm: '錠劑', singleCompoundFlag: '單方', manufacturer: 'Pfizer', temperatureReq: 'Room', expiryDays: 200, batchNo: 'N55234', stock_DEYI: 1, stock_SHISHENG_FX: 45, stock_GREAT_TREE: 60, stock_SHISHENG_KZ: 35, stock_ZISHENG: 25 },
        { drugCode: 'C10AA07100', drugChineseName: '冠脂妥 (Rosuvastatin) - 降血脂用藥', drugEnglishName: 'Crestor 10mg', price: 45, rxOnly: true, atcCode: 'C10AA07', dosageForm: '錠劑', singleCompoundFlag: '單方', manufacturer: 'AstraZeneca', temperatureReq: 'Room', expiryDays: 250, batchNo: 'R12934', stock_DEYI: 0, stock_SHISHENG_FX: 50, stock_GREAT_TREE: 70, stock_SHISHENG_KZ: 40, stock_ZISHENG: 30 }
    );
}

// Deduplicate inventory as we did in script.js
let uniqueDb = {};
inventoryList.forEach(item => {
    if (!uniqueDb[item.drugCode]) {
        uniqueDb[item.drugCode] = { ...item };
    } else {
        ['DEYI', 'SHISHENG_FX', 'GREAT_TREE', 'SHISHENG_KZ', 'ZISHENG', 'FUXING_HC', 'KAO_CLINIC'].forEach(st => {
            let field = 'stock_' + st;
            uniqueDb[item.drugCode][field] = (uniqueDb[item.drugCode][field] || 0) + (item[field] || 0);
        });
    }
});
inventoryList = Object.values(uniqueDb);

// Adjust default mock inventory levels based on user request
let lowStockDrugs = ['A07DA03100', 'M02AA13100']; // 樂必寧膠囊, 伊普芬液

inventoryList.forEach(item => {
    // 大溪區藥局：庫存非常充足
    item.stock_SHISHENG_FX = 150 + Math.floor(Math.random() * 100); // 150-249
    item.stock_GREAT_TREE = 150 + Math.floor(Math.random() * 100);
    item.stock_SHISHENG_KZ = 150 + Math.floor(Math.random() * 100);
    item.stock_ZISHENG = 150 + Math.floor(Math.random() * 100);

    // 復興區藥局 (得安 DEYI)：不要每個藥品都很可悲，大部分維持安全水位
    if (lowStockDrugs.includes(item.drugCode)) {
        // 挑選一兩個藥品刻意庫存極低，方便示範自動調撥
        item.stock_DEYI = Math.floor(Math.random() * 5); // 0-4
    } else {
        // 其他藥品維持正常水位
        item.stock_DEYI = 80 + Math.floor(Math.random() * 50); // 80-129
    }
});

// Initial Mock Requests (Set to empty to clear all requests on reset)
const initialRequests = [];

db.serialize(() => {
    // 1. Create inventory table
    db.run(`DROP TABLE IF EXISTS inventory`);
    db.run(`CREATE TABLE inventory (
        drugCode TEXT PRIMARY KEY,
        drugChineseName TEXT,
        drugEnglishName TEXT,
        price INTEGER,
        rxOnly INTEGER,
        atcCode TEXT,
        dosageForm TEXT,
        singleCompoundFlag TEXT,
        manufacturer TEXT,
        temperatureReq TEXT,
        stock_DEYI INTEGER DEFAULT 0,
        stock_FUXING_HC INTEGER DEFAULT 0,
        stock_KAO_CLINIC INTEGER DEFAULT 0,
        stock_SHISHENG_FX INTEGER DEFAULT 0,
        stock_GREAT_TREE INTEGER DEFAULT 0,
        stock_SHISHENG_KZ INTEGER DEFAULT 0,
        stock_ZISHENG INTEGER DEFAULT 0
    )`);

    // 2. Create requests table
    db.run(`DROP TABLE IF EXISTS requests`);
    db.run(`CREATE TABLE requests (
        id TEXT PRIMARY KEY,
        date TEXT,
        from_station TEXT,
        to_station TEXT,
        item TEXT,
        drugCode TEXT,
        qty INTEGER,
        status TEXT,
        targetTime TEXT,
        relatedReserveId TEXT,
        dispatchTime TEXT,
        logisticsCondition TEXT,
        payment TEXT,
        pickupTime TEXT,
        paidStatus TEXT,
        price INTEGER,
        prescriptionImg TEXT,
        prescriptionStatus TEXT
    )`);

    // Insert Inventory
    const stmt = db.prepare(`INSERT INTO inventory (drugCode, drugChineseName, drugEnglishName, price, rxOnly, atcCode, dosageForm, singleCompoundFlag, manufacturer, temperatureReq, stock_DEYI, stock_FUXING_HC, stock_KAO_CLINIC, stock_SHISHENG_FX, stock_GREAT_TREE, stock_SHISHENG_KZ, stock_ZISHENG) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    inventoryList.forEach(item => {
        stmt.run(
            item.drugCode, item.drugChineseName, item.drugEnglishName, item.price || 0, item.rxOnly ? 1 : 0, item.atcCode, item.dosageForm, item.singleCompoundFlag, item.manufacturer, item.temperatureReq,
            item.stock_DEYI || 0, item.stock_FUXING_HC || 0, item.stock_KAO_CLINIC || 0, item.stock_SHISHENG_FX || 0, item.stock_GREAT_TREE || 0, item.stock_SHISHENG_KZ || 0, item.stock_ZISHENG || 0
        );
    });
    stmt.finalize();

    // Insert Initial Requests
    const stmtReq = db.prepare(`INSERT INTO requests (id, date, from_station, to_station, item, drugCode, qty, status, targetTime, relatedReserveId, dispatchTime, logisticsCondition, payment, pickupTime, paidStatus, price, prescriptionImg, prescriptionStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    initialRequests.forEach(req => {
        stmtReq.run(req.id, req.date, req.from, req.to, req.item, req.drugCode || null, req.qty, req.status, req.targetTime || null, req.relatedReserveId || null, req.dispatchTime || null, req.logisticsCondition || null, req.payment || null, req.pickupTime || null, req.paidStatus || null, req.price || 0, req.prescriptionImg || null, req.prescriptionStatus || null);
    });
    stmtReq.finalize();

    console.log("資料庫初始化完成！已匯入 Mock Data！");
});

db.close();
