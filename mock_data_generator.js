const fs = require('fs');

// 健保署藥品主檔格式模擬 (Health-17 / H_NHI_DRUG / INAE3000S01)
// 欄位包括：藥品代碼 (10碼), 中文品名, 英文品名, 劑型, ATC分類, 健保單價, 單複方, 製造廠, 溫控要求
const baseDrugs = [
    { 
        drugCode: 'A059591100', 
        drugChineseName: '克流感膠囊 (Tamiflu) - 流感用藥', 
        drugEnglishName: 'Tamiflu Capsules 75mg', 
        dosageForm: '膠囊劑', 
        atcCode: 'J05AH02', 
        price: 950, 
        singleCompoundFlag: '單方', 
        manufacturer: 'Roche Registration Ltd.', 
        temperatureReq: 'Room', 
        rxOnly: true 
    },
    { 
        drugCode: 'B023245100', 
        drugChineseName: '普拿疼止痛錠 (Panadol) - 退燒止痛', 
        drugEnglishName: 'Panadol Tablets 500mg', 
        dosageForm: '錠劑', 
        atcCode: 'N02BE01', 
        price: 15, 
        singleCompoundFlag: '單方', 
        manufacturer: 'GlaxoSmithKline', 
        temperatureReq: 'Room', 
        rxOnly: false 
    },
    { 
        drugCode: 'C054890100', 
        drugChineseName: '樂必寧膠囊 (Loperamide) - 緩解腹瀉', 
        drugEnglishName: 'Loperamide Capsules 2mg', 
        dosageForm: '膠囊劑', 
        atcCode: 'A07DA03', 
        price: 20, 
        singleCompoundFlag: '單方', 
        manufacturer: 'Standard Chem. & Pharm.', 
        temperatureReq: 'Room', 
        rxOnly: false 
    },
    { 
        drugCode: 'D045980100', 
        drugChineseName: '伊普芬液 (Ibuprofen) - 兒童腸病毒退燒', 
        drugEnglishName: 'Ibuprofen Oral Suspension', 
        dosageForm: '口服液劑', 
        atcCode: 'M01AE01', 
        price: 120, 
        singleCompoundFlag: '單方', 
        manufacturer: 'Synmosa Biopharma', 
        temperatureReq: 'Room', 
        rxOnly: false 
    },
    { 
        drugCode: 'E060800100', 
        drugChineseName: '倍拉維 (Paxlovid) - COVID-19專用藥', 
        drugEnglishName: 'Paxlovid Film-Coated Tablets', 
        dosageForm: '包衣錠劑', 
        atcCode: 'J05AE30', 
        price: 20000, 
        singleCompoundFlag: '複方', 
        manufacturer: 'Pfizer Ireland Pharmaceuticals', 
        temperatureReq: 'Room', 
        rxOnly: true 
    },
    { 
        drugCode: 'I012345678', 
        drugChineseName: '胰島素注射劑 (Insulin) - 糖尿病慢箋', 
        drugEnglishName: 'Novomix 30 Flexpen', 
        dosageForm: '注射劑', 
        atcCode: 'A10AD05', 
        price: 800, 
        singleCompoundFlag: '複方', 
        manufacturer: 'Novo Nordisk A/S', 
        temperatureReq: 'Cold Chain 2-8°C', 
        rxOnly: true 
    }
];

// 模擬生成 7 個據點的即時庫存資料
const generateInventory = () => {
    let inventory = [];
    baseDrugs.forEach(drug => {
        // 隨機產生 2 批不同效期的庫存
        for(let i=0; i<2; i++) {
            let daysToExpiry = Math.floor(Math.random() * 200) + 15; // 15 到 215天
            let expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + daysToExpiry);
            
            inventory.push({
                drugCode: drug.drugCode,
                drugChineseName: drug.drugChineseName,
                drugEnglishName: drug.drugEnglishName,
                dosageForm: drug.dosageForm,
                atcCode: drug.atcCode,
                price: drug.price,
                singleCompoundFlag: drug.singleCompoundFlag,
                manufacturer: drug.manufacturer,
                temperatureReq: drug.temperatureReq,
                rxOnly: drug.rxOnly,
                batchNo: `B${Math.floor(Math.random() * 90000) + 10000}`,
                expiryDate: expiryDate.toISOString().split('T')[0],
                expiryDays: daysToExpiry,
                // 復興區庫存 (山地偏鄉，我們設定為極低或 0 盒，以觸發安全水位告急與調撥機制)
                stock_DEYI: Math.floor(Math.random() * 4),       // 德怡藥局 (0~3盒)
                stock_FUXING_HC: Math.floor(Math.random() * 4),  // 復興區衛生所
                stock_KAO_CLINIC: Math.floor(Math.random() * 2),     // 高揚威診所
                // 大溪區庫存 (靠近都市，母艦據點，有時也讓部分藥局缺貨以測試二階調撥)
                stock_SHISHENG_FX: Math.random() > 0.8 ? 0 : Math.floor(Math.random() * 80) + 40, // 新資生復興店 (有20%機率為0)
                stock_GREAT_TREE: Math.random() > 0.8 ? 0 : Math.floor(Math.random() * 100) + 50, // 大樹大溪康莊店
                stock_SHISHENG_KZ: Math.floor(Math.random() * 70) + 30, // 新資生康莊店
                stock_ZISHENG: Math.floor(Math.random() * 60) + 20      // 資生大藥局
            });
        }
    });
    return inventory;
};

// 模擬過去兩年的每月報廢率、缺藥次數與傳染病數據 (量化報廢及階段指標)
const generateKPIs = () => {
    let kpiData = [];
    const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    
    months.forEach((month, idx) => {
        // 去年（未實施大溪-復興跨區聯合調度）報廢率較高：8.5% - 13.0%
        let lastYearScrap = (Math.random() * 4.5 + 8.5).toFixed(1); 
        // 今年（導入跨區智慧調撥平台後）報廢率顯著下降：3.2% - 5.5%
        let thisYearScrap = (Math.random() * 2.3 + 3.2).toFixed(1); 
        
        // 缺藥次數 (去年 vs 今年同期對比，列出具體成效目標)
        let lastShortages = Math.floor(Math.random() * 12 + 10); // 10-22 次
        let thisShortages = Math.floor(lastShortages * (0.15 + Math.random() * 0.15)); // 2-6 次 (降低60%-80%)
        
        // NIDSS 季節性傳染病病例趨勢模擬 (疾管署傳染病統計資料來源)
        let fluCases = (idx >= 11 || idx <= 2) ? Math.floor(Math.random() * 6000 + 9000) : Math.floor(Math.random() * 800 + 1500); 
        let enterovirusCases = (idx >= 4 && idx <= 8) ? Math.floor(Math.random() * 4000 + 6000) : Math.floor(Math.random() * 300 + 800);
        let diarrheaCases = (idx === 0 || idx === 1 || idx === 8) ? Math.floor(Math.random() * 12000 + 15000) : Math.floor(Math.random() * 6000 + 8000);
        let dengueCases = (idx >= 7 && idx <= 10) ? Math.floor(Math.random() * 200 + 400) : Math.floor(Math.random() * 5 + 15);

        kpiData.push({
            month: month,
            lastYearScrapRate: parseFloat(lastYearScrap),
            thisYearScrapRate: parseFloat(thisYearScrap),
            lastShortageCount: lastShortages,
            thisShortageCount: thisShortages,
            flu: fluCases,
            enterovirus: enterovirusCases,
            diarrhea: diarrheaCases,
            dengue: dengueCases
        });
    });
    return kpiData;
};

const main = () => {
    const inventoryData = generateInventory();
    const kpiData = generateKPIs();
    
    const output = {
        metaData: {
            source: "衛生福利部疾病管制署 NIDSS 傳染病統計資料查詢系統 & 全民健康保險署特約藥品主檔 INAE3000S01 格式",
            description: "桃園市復興區與大溪區智慧藥局聯合調度PoC模擬用藥資料庫。包含去去年與今年同期藥品報廢率、缺藥頻次、以及流感/腸病毒/腹瀉/登革熱季節性用藥趨勢。",
            generatedAt: new Date().toISOString()
        },
        inventory: inventoryData,
        monthlyKPIs: kpiData
    };
    
    fs.writeFileSync('mock_nhi_data.json', JSON.stringify(output, null, 2));
    console.log("✅ 成功生成符合健保署與疾管署格式的模擬用藥資料庫：mock_nhi_data.json");
};

main();
