const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

// Replace localStorage sets
code = code.replace(/localStorage\.setItem\('SmartPharma_Inventory',\s*JSON\.stringify\(dbInventory\)\);?/g, 'syncToDatabase();');
code = code.replace(/localStorage\.setItem\('SmartPharma_Requests',\s*JSON\.stringify\(dbRequests\)\);?/g, 'syncToDatabase();');
code = code.replace(/localStorage\.setItem\('SmartPharma_Requests',\s*JSON\.stringify\(requests\)\);?/g, 'dbRequests = requests; syncToDatabase();');
code = code.replace(/syncToDatabase\(\);\s*syncToDatabase\(\);/g, 'syncToDatabase();');

// Inject syncToDatabase function at the bottom
if (!code.includes('async function syncToDatabase')) {
    code += `\n// =========================================================================\n// API SYNC LOGIC (Replaces LocalStorage)\n// =========================================================================\nasync function syncToDatabase() {\n    try {\n        await fetch('http://localhost:3000/api/syncInventory', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify(dbInventory)\n        });\n        await fetch('http://localhost:3000/api/syncRequests', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify(dbRequests)\n        });\n    } catch (error) {\n        console.error("Database sync failed:", error);\n    }\n}\n`;
}

// Rewrite fetchSystemData
const fetchRegex = /async function fetchSystemData\(\) \{[\s\S]*?function triggerReservationFlow/m;
const newFetch = `async function fetchSystemData() {
    try {
        const invRes = await fetch('http://localhost:3000/api/inventory');
        dbInventory = await invRes.json();
        
        dbInventory.forEach(item => {
            item.usageCategory = getDrugCategory(item);
        });

        const reqRes = await fetch('http://localhost:3000/api/requests');
        dbRequests = await reqRes.json();
        
        if (!dbRequests || dbRequests.length === 0) {
            dbRequests = seedMockRequests();
        }
    } catch (e) {
        console.error("無法連線至後端資料庫:", e);
        showToast("資料庫連線失敗，請確認後端伺服器是否啟動", "error");
    }
    
    updateSystemState();
    fetchRealTimeWeather(true);
}

function triggerReservationFlow`;

code = code.replace(fetchRegex, newFetch);

fs.writeFileSync('script.js', code, 'utf8');
