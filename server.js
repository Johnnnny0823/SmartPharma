const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large requests for base64 images
app.use(express.static(__dirname)); // 讓伺服器可以直接提供 HTML 等靜態網頁檔案

const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READWRITE, (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to the SQLite database.');
});

// 處理未捕捉到的例外，防止伺服器閃退
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// GET /api/inventory
app.get('/api/inventory', (req, res) => {
    try {
        db.all(`SELECT * FROM inventory`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const data = rows.map(r => ({...r, rxOnly: r.rxOnly === 1}));
            res.json(data);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/requests
app.get('/api/requests', (req, res) => {
    try {
        db.all(`SELECT * FROM requests`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const data = rows.map(r => {
                const out = {...r, from: r.from_station, to: r.to_station};
                delete out.from_station;
                delete out.to_station;
                return out;
            });
            res.json(data);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/syncInventory
app.post('/api/syncInventory', (req, res) => {
    try {
        const inventory = req.body;
        if (!Array.isArray(inventory)) {
            return res.status(400).json({ error: 'Invalid format: expected array' });
        }
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare(`INSERT OR REPLACE INTO inventory (drugCode, drugChineseName, drugEnglishName, price, rxOnly, atcCode, dosageForm, singleCompoundFlag, manufacturer, temperatureReq, stock_DEYI, stock_FUXING_HC, stock_KAO_CLINIC, stock_SHISHENG_FX, stock_GREAT_TREE, stock_SHISHENG_KZ, stock_ZISHENG) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const item of inventory) {
                stmt.run(
                    item.drugCode, item.drugChineseName, item.drugEnglishName, item.price || 0, item.rxOnly ? 1 : 0, item.atcCode, item.dosageForm, item.singleCompoundFlag, item.manufacturer, item.temperatureReq,
                    item.stock_DEYI || 0, item.stock_FUXING_HC || 0, item.stock_KAO_CLINIC || 0, item.stock_SHISHENG_FX || 0, item.stock_GREAT_TREE || 0, item.stock_SHISHENG_KZ || 0, item.stock_ZISHENG || 0
                );
            }
            stmt.finalize();
            db.run('COMMIT', (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'success' });
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/syncRequests
app.post('/api/syncRequests', (req, res) => {
    try {
        const requests = req.body;
        if (!Array.isArray(requests)) {
            return res.status(400).json({ error: 'Invalid format: expected array' });
        }
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            // Clear requests table and re-insert to keep it perfectly synced with frontend
            db.run('DELETE FROM requests');
            const stmt = db.prepare(`INSERT INTO requests (id, date, from_station, to_station, item, drugCode, qty, status, targetTime, relatedReserveId, dispatchTime, logisticsCondition, payment, pickupTime, paidStatus, price, prescriptionImg, prescriptionStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const reqItem of requests) {
                stmt.run(reqItem.id, reqItem.time || reqItem.date, reqItem.from, reqItem.to, reqItem.item, reqItem.drugCode || null, reqItem.qty, reqItem.status, reqItem.targetTime || null, reqItem.relatedReserveId || null, reqItem.dispatchTime || null, reqItem.logisticsCondition || null, reqItem.payment || null, reqItem.pickupTime || null, reqItem.paidStatus || null, reqItem.price || 0, reqItem.prescriptionImg || null, reqItem.prescriptionStatus || null);
            }
            stmt.finalize();
            db.run('COMMIT', (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'success' });
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/disease-seasonal?county=桃園市&years=5
// 讀取 fetch_cdc_data.py 寫入的 disease_monthly，算出各疾病每月平均就診人次與占全年比例
app.get('/api/disease-seasonal', (req, res) => {
    const county = (req.query.county || '').trim();
    const yearsWanted = Math.min(Math.max(parseInt(req.query.years, 10) || 5, 1), 20);
    const thisYear = new Date().getFullYear();
    const all = (sql, params) => new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

    (async () => {
        // 只取已經結束的完整年度，避免今年資料不完整拉低平均
        let yearRows = await all(
            'SELECT DISTINCT year FROM disease_monthly WHERE year < ? ORDER BY year DESC LIMIT ?',
            [thisYear, yearsWanted]);
        if (yearRows.length === 0) {
            yearRows = await all('SELECT DISTINCT year FROM disease_monthly ORDER BY year DESC LIMIT ?', [yearsWanted]);
        }
        if (yearRows.length === 0) return res.json({ available: false, reason: 'empty' });

        const years = yearRows.map(r => r.year).sort((a, b) => a - b);
        const yearFrom = years[0];
        const yearTo = years[years.length - 1];

        const countyFilter = county ? 'AND county = ?' : '';
        const params = county ? [yearFrom, yearTo, county] : [yearFrom, yearTo];
        const rows = await all(
            `SELECT disease_code, disease_name, drug_hint, month, SUM(cases) AS cases
               FROM disease_monthly
              WHERE year BETWEEN ? AND ? ${countyFilter}
              GROUP BY disease_code, disease_name, drug_hint, month`, params);
        const counties = await all(
            `SELECT county, SUM(cases) AS cases FROM disease_monthly
              WHERE year BETWEEN ? AND ? GROUP BY county ORDER BY cases DESC`, [yearFrom, yearTo]);
        const log = await all('SELECT disease_code, fetched_at FROM cdc_fetch_log', []).catch(() => []);

        const order = ['flu', 'ev', 'diarrhea'];
        const byCode = {};
        for (const r of rows) {
            const d = byCode[r.disease_code] || (byCode[r.disease_code] = {
                code: r.disease_code, name: r.disease_name, drug: r.drug_hint, totals: Array(12).fill(0)
            });
            d.totals[r.month - 1] += r.cases;
        }
        const rank = code => (order.includes(code) ? order.indexOf(code) : 99);
        const diseases = Object.values(byCode)
            .sort((a, b) => rank(a.code) - rank(b.code))
            .map(d => {
                const sum = d.totals.reduce((a, b) => a + b, 0);
                return {
                    code: d.code, name: d.name, drug: d.drug, totalCases: sum,
                    monthlyAvg: d.totals.map(v => Math.round((v / years.length) * 10) / 10),
                    share: d.totals.map(v => (sum ? Math.round((v / sum) * 1000) / 10 : 0)),
                    peakMonth: sum ? d.totals.indexOf(Math.max(...d.totals)) + 1 : null
                };
            });

        res.json({
            available: true,
            county: county || '全國',
            yearFrom, yearTo, yearCount: years.length,
            counties: counties.map(c => c.county),
            fetchedAt: log.map(l => l.fetched_at).sort().pop() || null,
            diseases
        });
    })().catch(err => {
        if (/no such table/.test(err.message)) {
            return res.json({ available: false, reason: 'not_fetched' });
        }
        res.status(500).json({ error: err.message });
    });
});

// POST /api/reset
app.post('/api/reset', (req, res) => {
    try {
        exec('node init_db.js', (error, stdout, stderr) => {
            if (error) {
                console.error('Error resetting database:', error);
                return res.status(500).json({ error: error.message });
            }
            res.json({ status: 'success', message: 'Database reset successfully' });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port} (Available on network IP)`);
});
