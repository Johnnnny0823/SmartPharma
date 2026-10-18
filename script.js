let currentRole = ''; 
let currentStation = ''; 
let currentStationName = '';
let dbInventory = []; 
let dbRequests = []; 
let tempReserveData = null; 
let tempTransferData = null; 
let activeViewPrescriptionId = null; // For pharmacist verification

// Dynamic Local Base64 Prescription Generator
let tempPrescriptionImgBase64 = '';
let isCustomUploaded = false; 
let currentWeatherMode = 'sunny';
let weatherSimulationMode = 'sunny';
let currentInventoryFilter = 'all';

// --- Driver Live Navigation Variables ---
let isVoiceNavEnabled = false;
let liveNavInterval = null;
let navProgressPct = 0; // 0 to 100
let activeNavTask = null;

function getSafetyStockThreshold(item = null) {
    let base = 10;
    if (item && item.usageCategory === '緊急用') {
        base = 25; // 季節性疾病與用藥分佈預測，拉高安全水位
    }
    if (currentWeatherMode === 'rainy') {
        return Math.floor(base * 1.5);
    } else if (currentWeatherMode === 'typhoon') {
        return Math.floor(base * 2.0);
    }
    return base; // default sunny
}

function autoTriggerRestock(item, toStation, shortageAmt) {
    if (toStation === 'HQ' || toStation === 'TRUCK' || toStation === '民眾') return;

    // 若系統已針對此藥局及此藥品自動發起過調撥（不論狀態），即不再重複發起，避免刷單
    let autoFlag = 'autoRequested_' + toStation;
    if (item[autoFlag]) return;

    // Check if there is already an ongoing restock for this item to this station
    let pending = dbRequests.find(r => r.to === toStation && r.drugCode === item.drugCode && (r.status === '待審核' || r.status === '已核准出庫' || r.status === '專車配送中'));
    if (pending) return;

    // Find nearest station with enough stock
    let candidates = Object.keys(STATIONS_METADATA).filter(s => s !== toStation && s !== 'HQ' && s !== 'TRUCK' && s !== 'DEYI');
    if (toStation === 'DEYI') candidates = Object.keys(STATIONS_METADATA).filter(s => s !== 'DEYI' && s !== 'HQ' && s !== 'TRUCK');
    
    let bestStation = null;
    let minDist = Infinity;

    candidates.forEach(cand => {
        let candStock = item['stock_' + cand] || 0;
        let candThresh = getSafetyStockThreshold(item);
        if (candStock > candThresh + shortageAmt) {
            let d = getDistance(cand, toStation);
            if (d < minDist) {
                minDist = d;
                bestStation = cand;
            }
        }
    });

    if (bestStation) {
        let reqId = 'REQ-' + Math.floor(1000 + Math.random() * 9000);
        let req = {
            id: reqId,
            from: bestStation,
            to: toStation,
            item: item.drugChineseName,
            drugCode: item.drugCode,
            qty: shortageAmt + 10,
            status: '待審核',
            time: getCurrentTime(),
            targetTime: "",
            dispatchTime: "",
            logisticsCondition: "常溫運輸中"
        };
        dbRequests.push(req);
        // 標記此藥品於該藥局已自動觸發過調撥申請，避免重複觸發
        item['autoRequested_' + toStation] = true;
        syncToDatabase();
        showToast(`AI預測：${item.drugChineseName} 庫存低於季節性安全水位，已自動向最近的 ${STATIONS_METADATA[bestStation].name} 發出調撥請求！`, 'warning');
    }
}

function findSubstituteDrug(med, stationCode) {
    if (!med || !med.atcCode) return null;
    const atcPrefix = med.atcCode.substring(0, 3); // e.g. "N02" or "A10"
    const stockField = 'stock_' + stationCode;
    return dbInventory.find(item => 
        item.drugCode !== med.drugCode && 
        item.atcCode.startsWith(atcPrefix) && 
        (item[stockField] || 0) > 0
    );
}

function checkSubstitution() {
    const alertBox = document.getElementById('substituteAlertBox');
    if (!alertBox) return;

    if (tempReserveData && tempReserveData.rejectedSubstitute) {
        alertBox.style.display = 'none';
        return;
    }

    let med = dbInventory.find(m => m.drugCode === tempReserveData.drugCode);
    if (!med) {
        alertBox.style.display = 'none';
        return;
    }

    let stockField = 'stock_' + tempReserveData.station;
    let availableStock = med[stockField] || 0;

    if (availableStock < tempReserveData.qty) {
        // Look for similar drug in the same station
        let subMed = findSubstituteDrug(med, tempReserveData.station);
        if (subMed) {
            let subStock = subMed[stockField] || 0;
            // Only suggest if the substitute itself has enough stock for the request!
            if (subStock >= tempReserveData.qty) {
                tempReserveData.substitute = {
                    item: subMed.drugChineseName,
                    drugCode: subMed.drugCode,
                    unitPrice: subMed.price,
                    rxOnly: subMed.rxOnly
                };

                let labelText = subMed.rxOnly 
                    ? '<span class="badge badge-danger" style="font-size:0.7rem; padding:2px 6px;">Rx 處方替換建議 (需取藥時配合健保卡雲端藥歷由藥師確認並登記)</span>' 
                    : '<span class="badge badge-success" style="font-size:0.7rem; padding:2px 6px;">OTC 免憑證相似藥直接替代</span>';

                let substText = `⚠️ 本據點「${tempReserveData.item}」現有庫存僅 ${availableStock} 盒，不足您預約的 ${tempReserveData.qty} 盒。<br>
                💡 推薦相似替代藥品：<strong>${subMed.drugChineseName}</strong> (本店現貨剩餘 ${subStock} 盒，每盒 $${subMed.price})。<br>
                ${labelText}<br><br>
                您可以：<br>
                • <b>選項 A (專車調撥)</b>：仍預約原藥，由大溪母艦藥局專車配送 (預計需等待數小時)。<br>
                • <b>選項 B (相似替代)</b>：立即更換為同效能替代藥，可直接在現場立即取藥，免等待！`;
                
                document.getElementById('substituteText').innerHTML = substText;
                alertBox.style.display = 'block';
                return;
            }
        }
    }
    
    alertBox.style.display = 'none';
    if (tempReserveData) {
        delete tempReserveData.substitute;
    }
}

function chooseSubstituteOption() {
    if (!tempReserveData || !tempReserveData.substitute) return;
    const sub = tempReserveData.substitute;
    
    tempReserveData.item = sub.item;
    tempReserveData.drugCode = sub.drugCode;
    tempReserveData.unitPrice = sub.unitPrice;
    tempReserveData.totalPrice = tempReserveData.qty * sub.unitPrice;
    
    document.getElementById('payItemName').innerText = tempReserveData.item;
    document.getElementById('payItemUnitPrice').innerText = tempReserveData.unitPrice;
    document.getElementById('payItemTotalPrice').innerText = tempReserveData.totalPrice;
    
    if (sub.rxOnly) {
        if (!isCustomUploaded) {
            tempReserveData.prescriptionImg = generateDummyPrescriptionBase64(tempReserveData.item, tempReserveData.qty);
        }
    } else {
        if (!isCustomUploaded) {
            tempReserveData.prescriptionImg = '';
        }
    }

    showToast(`已更換預約為替代藥品：${sub.item}！`, 'success');
    delete tempReserveData.substitute;
    document.getElementById('substituteAlertBox').style.display = 'none';
}

function keepOriginalOption() {
    if (tempReserveData) {
        tempReserveData.rejectedSubstitute = true;
    }
    document.getElementById('substituteAlertBox').style.display = 'none';
    showToast("已選擇保留原藥，將為您調度物流專車。", "info");
}

function loadSamplePrescription() {
    const sampleMed = "普拿疼止痛錠 (Panadol) - 退燒止痛";
    tempPrescriptionImgBase64 = generateDummyPrescriptionBase64(sampleMed, 1);
    isCustomUploaded = false; // Set to false because this is a simulated template
    
    const preview = document.getElementById('uploadPreview');
    if (preview) {
        preview.src = tempPrescriptionImgBase64;
        preview.style.display = 'block';
        showToast("已成功載入範例處方箋相片！", "success");
    }
}

function simulateWeatherChange(val) {
    weatherSimulationMode = val;
    const badge = document.getElementById('weather-sync-badge');
    if (val === 'api') {
        if (badge) {
            badge.style.background = '#e2fbe8';
            badge.style.color = '#10b981';
            badge.style.borderColor = '#a7f3d0';
            badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> CWA 自動即時同步';
        }
        fetchRealTimeWeather();
    } else {
        if (badge) {
            badge.style.background = '#fffbeb';
            badge.style.color = '#d97706';
            badge.style.borderColor = '#fef3c7';
            badge.innerHTML = '<i class="fa-solid fa-flask"></i> 系統模擬開發模式';
        }
        if (val === 'sunny') {
            updateWeatherState('sunny', 10, 0);
            showToast("已手動模擬：晴朗常態天氣 (備貨水位 1.0x)", "success");
        } else if (val === 'rainy') {
            updateWeatherState('rainy', 85, 15);
            showToast("已手動模擬：大雨特報預警 (防汛備貨 1.5x)", "warning");
        } else if (val === 'typhoon') {
            updateWeatherState('typhoon', 99, 65);
            showToast("已手動模擬：颱風警戒警戒 (預防斷藥 2.0x)", "error");
        }
        updateSystemState();
    }
}

async function fetchRealTimeWeather(isInitial = false) {
    const badge = document.getElementById('weather-sync-badge');
    if (weatherSimulationMode !== 'api') {
        let mode = weatherSimulationMode;
        if (badge) {
            badge.style.background = '#fffbeb';
            badge.style.color = '#d97706';
            badge.style.borderColor = '#fef3c7';
            badge.innerHTML = '<i class="fa-solid fa-flask"></i> 系統模擬開發模式';
        }
        if (mode === 'sunny') updateWeatherState('sunny', 10, 0);
        else if (mode === 'rainy') updateWeatherState('rainy', 85, 15);
        else if (mode === 'typhoon') updateWeatherState('typhoon', 99, 65);
        return;
    }
    if (badge) {
        badge.style.background = '#e2fbe8';
        badge.style.color = '#10b981';
        badge.style.borderColor = '#a7f3d0';
        badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> CWA 自動即時同步';
    }
    const refreshBtn = document.querySelector('#shared-weather-card button');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 載入中...';
    }
    
    try {
        const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=24.8210&longitude=121.3526&daily=weather_code,precipitation_probability_max,precipitation_sum&timezone=Asia/Taipei&forecast_days=1");
        if (!response.ok) throw new Error("API response error");
        const data = await response.json();
        
        const daily = data.daily;
        if (daily && daily.weather_code && daily.weather_code.length > 0) {
            const weatherCode = daily.weather_code[0];
            const rainProb = daily.precipitation_probability_max[0] || 0;
            const rainSum = daily.precipitation_sum[0] || 0;
            
            let mode = 'sunny';
            if (rainSum >= 30 || [95, 96, 99].includes(weatherCode)) {
                mode = 'typhoon';
            } else if (rainSum >= 5 || rainProb >= 50 || [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
                mode = 'rainy';
            }
            
            updateWeatherState(mode, rainProb, rainSum);
            if (!isInitial && currentRole) {
                showToast(`已成功同步最新氣象資料！復興區日雨量預估 ${rainSum}mm，降雨機率 ${rainProb}%。`, 'success');
            }
        }
    } catch (e) {
        console.warn("⚠️ 氣象 API 取得失敗，改用離線歷史平均資料連動！", e);
        let mode = currentWeatherMode || 'sunny';
        updateWeatherState(mode, mode === 'sunny' ? 10 : (mode === 'rainy' ? 85 : 99), mode === 'sunny' ? 0 : (mode === 'rainy' ? 150 : 450));
        if (!isInitial && currentRole) {
            showToast("已成功啟用氣象署歷史平均備貨係數連動 (離線模式)", "info");
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新整理氣象';
        }
    }
}

function updateWeatherState(mode, rainProb, rainSum) {
    currentWeatherMode = mode;
    
    const icon = document.getElementById('weather-icon');
    const statusText = document.getElementById('weather-status-text');
    const rainProbLabel = document.getElementById('weather-rain-prob');
    const summaryText = document.getElementById('weather-summary-text');
    
    // Calculate dates dynamically
    const d = new Date();
    const tom = new Date(d);
    tom.setDate(d.getDate() + 1);
    const currentMonth = String(d.getMonth() + 1).padStart(2, '0');
    const currentDate = String(d.getDate()).padStart(2, '0');
    
    // For sunny simulation, use 17:16 to match CWA regular issue. Otherwise use current hour/min.
    const isSunnySim = (mode === 'sunny' && weatherSimulationMode === 'sunny');
    const updateHour = isSunnySim ? '17' : String(d.getHours()).padStart(2, '0');
    const updateMin = isSunnySim ? '16' : String(d.getMinutes()).padStart(2, '0');
    
    if (mode === 'sunny') {
        if (icon) icon.innerText = '☀️';
        if (statusText) statusText.innerText = '當前天氣：晴朗常態 (無警報)';
        if (rainProbLabel) rainProbLabel.innerText = `降雨機率預估: ${rainProb}% (日累積雨量 ${rainSum}mm)`;
        
        if (summaryText) {
            summaryText.innerHTML = `
                <div style="font-weight: 800; color: var(--primary-color); margin-bottom: 6px;"><i class="fa-solid fa-circle-info"></i> CWA 詳細天氣預警報告及生活指引：</div>
                <strong>多雲時陰，天氣穩定且舒適</strong><br>
                <span style="color: var(--text-muted); font-size: 0.78rem;">【更新時間：${currentMonth}/${currentDate} ${updateHour}:${updateMin}】</span><br>
                今晚至明晨（${tom.getDate()}日）天氣為多雲時陰，降雨機率0%；明天白天轉為多雲時晴，降雨機率則為10%。氣溫25至34度，感覺舒適至悶熱。<br>
                風浪：偏南風5至6陣風8級，浪高1至2公尺，屬於小浪至中浪。<br>
                提醒您，明日白天氣溫舒適偏熱，從事戶外活動請適時補充水分，避免過度曝曬。強風特報，注意風勢與行車安全。
            `;
        }
    } else if (mode === 'rainy') {
        if (icon) icon.innerText = '⛈️';
        if (statusText) statusText.innerText = '當前天氣：大雨特報 (防汛備貨 1.5x)';
        if (rainProbLabel) rainProbLabel.innerText = `降雨機率預估: ${rainProb}% (日累積雨量 ${rainSum}mm)`;
        
        if (summaryText) {
            summaryText.innerHTML = `
                <div style="font-weight: 800; color: #d97706; margin-bottom: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> CWA 詳細天氣預警報告及生活指引：</div>
                <strong>🌧️ 大雨特報：對流雲系發展旺盛，局部地區有大雨發生的機率</strong><br>
                <span style="color: var(--text-muted); font-size: 0.78rem;">【更新時間：${currentMonth}/${currentDate} ${updateHour}:${updateMin}】</span><br>
                今晚至明天復興山區受滯留鋒面影響，天氣為陰有陣雨或雷雨，降雨機率為 ${rainProb}%，預估日累積雨量達 ${rainSum}mm。氣溫22至28度，感覺濕涼。<br>
                風浪：偏西南風4至5陣風7級，浪高1.5公尺，易有強陣風與雷擊。<br>
                提醒您，強降雨易造成山區道路視線不良與路面濕滑。台7線部分易坍方路段（如榮華段、巴陵段）請注意落石。行車請開啟大燈並減速慢行，避免前往山區溪谷從事水上活動。
            `;
        }
    } else if (mode === 'typhoon') {
        if (icon) icon.innerText = '🌀';
        if (statusText) statusText.innerText = '當前天氣：颱風警戒 (預防斷藥 2.0x)';
        if (rainProbLabel) rainProbLabel.innerText = `降雨機率預估: ${rainProb}% (日累積雨量 ${rainSum}mm)`;
        
        if (summaryText) {
            summaryText.innerHTML = `
                <div style="font-weight: 800; color: var(--danger-color); margin-bottom: 6px;"><i class="fa-solid fa-circle-exclamation"></i> CWA 詳細天氣預警報告及生活指引：</div>
                <strong>🌀 陸上颱風警報：受中度颱風環流影響，復興山區進入強風豪雨警戒範圍</strong><br>
                <span style="color: var(--text-muted); font-size: 0.78rem;">【更新時間：${currentMonth}/${currentDate} ${updateHour}:${updateMin}】</span><br>
                今晚至明天復興區受颱風眼牆或外圍環流直接影響，降雨機率99%，24小時預估累積雨量達 ${Math.max(200, Math.round(rainSum * 3))}mm（達超大豪雨等級）。氣溫20至24度，風勢極為強勁。<br>
                風浪：偏東風轉西北風8至9陣風11級，浪高5公尺以上，屬於巨浪。<br>
                提醒您，復興山區已列入土石流黃色或紅色警戒區域。台7線北橫公路隨時可能實施預防性封路，請山區居民備妥3天份常備藥品，減少非必要外出，密切注意最新防災訊息。
            `;
        }
    }

    const adminAlertBox = document.getElementById('adminWeatherAlertBox');
    if (adminAlertBox) {
        if (mode === 'sunny') {
            adminAlertBox.style.background = '#f0fdf4';
            adminAlertBox.style.borderLeft = '5px solid var(--secondary-color)';
            adminAlertBox.innerHTML = `
                <div style="font-size: 2.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">☀️</div>
                <div>
                    <h4 style="margin: 0 0 6px 0; color: var(--secondary-color); font-size: 1.1rem; font-weight: 800;">☀️ CWA 中央氣象署連動：桃園復興山區 晴朗常態</h4>
                    <p style="margin: 0; font-size: 0.92rem; color: var(--text-dark); line-height: 1.6;">
                        當前天氣狀況晴朗良好，道路通暢無阻。<br>
                        <span class="badge badge-success" style="font-size:0.75rem; margin-top:4px;">[AI 決策執行]</span> 系統維持標準安全備貨水位 (安全天數 7 天 / 1.0x 安全庫存)。
                    </p>
                </div>
            `;
        } else if (mode === 'rainy') {
            adminAlertBox.style.background = '#fffbeb';
            adminAlertBox.style.borderLeft = '5px solid var(--warning-color)';
            adminAlertBox.innerHTML = `
                <div style="font-size: 2.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">⛈️</div>
                <div>
                    <h4 style="margin: 0 0 6px 0; color: var(--warning-color); font-size: 1.1rem; font-weight: 800;">⚠️ CWA 中央氣象署災防連動：桃園復興山區 大雨特報</h4>
                    <p style="margin: 0; font-size: 0.92rem; color: var(--text-dark); line-height: 1.6;">
                        復興山區降雨機率預估 <strong>${rainProb}%</strong> (累積雨量 ${rainSum}mm)，台七線可能發生零星坍方落石風險。<br>
                        <span class="badge badge-danger" style="font-size:0.75rem; margin-top:4px;">[AI 決策執行]</span> 系統已自動將德怡藥局之<b>安全備貨天數由 7 天調升至 10.5 天 (1.5x)</b>，防範因雨道路受阻中斷。
                    </p>
                </div>
            `;
        } else if (mode === 'typhoon') {
            adminAlertBox.style.background = '#fff1f2';
            adminAlertBox.style.borderLeft = '5px solid var(--danger-color)';
            adminAlertBox.innerHTML = `
                <div style="font-size: 2.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">🌀</div>
                <div>
                    <h4 style="margin: 0 0 6px 0; color: var(--danger-color); font-size: 1.1rem; font-weight: 800;">🚨 CWA 中央氣象署防颱特警：桃園復興區 颱風警報</h4>
                    <p style="margin: 0; font-size: 0.92rem; color: var(--text-dark); line-height: 1.6;">
                        復興山區發布土石流黃色警戒，局部路段預警性封閉 (日累積雨量已達 ${rainSum}mm)。<br>
                        <span class="badge badge-danger" style="font-size:0.75rem; margin-top:4px;">[AI 決策執行]</span> 系統已自動將全區偏鄉特約據點<b>安全儲備天數調升至 14 天 (2.0x)</b>，要求大溪母艦藥局執行預防性大宗調撥。
                    </p>
                </div>
            `;
        }
    }
    updateSystemState();
}

function getDistance(codeA, codeB) {
    let a = STATIONS_METADATA[codeA];
    let b = STATIONS_METADATA[codeB];
    if (!a || !b) return 0;
    
    const R = 6371; // Earth radius in km
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    
    const x = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    return R * c;
}

function optimizeDriverRoute() {
    let activeTasks = dbRequests.filter(req => req.status === '已核准出庫' || req.status === '專車配送中');
    
    const routePlanner = document.getElementById('driverRoutePlanner');
    const routeEmpty = document.getElementById('driverRouteEmpty');
    
    if (!routePlanner || !routeEmpty) return;
    
    if (activeTasks.length === 0) {
        routePlanner.style.display = 'none';
        routeEmpty.style.display = 'block';
        return;
    }
    
    routePlanner.style.display = 'block';
    routeEmpty.style.display = 'none';
    
    let locations = new Set();
    activeTasks.forEach(task => {
        if (STATIONS_METADATA[task.from]) locations.add(task.from);
        if (STATIONS_METADATA[task.to]) locations.add(task.to);
    });
    
    // HQ serves as the logistics hub starting point
    let currentLoc = 'HQ';
    let route = [currentLoc];
    let candidates = Array.from(locations).filter(loc => loc !== currentLoc);
    
    while (candidates.length > 0) {
        let nearestIndex = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            let dist = getDistance(currentLoc, candidates[i]);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestIndex = i;
            }
        }
        currentLoc = candidates[nearestIndex];
        route.push(currentLoc);
        candidates.splice(nearestIndex, 1);
    }
    
    let totalDist = 0;
    let legs = [];
    for (let i = 0; i < route.length - 1; i++) {
        let dist = getDistance(route[i], route[i+1]);
        totalDist += dist;
        legs.push(dist);
    }
    let totalTime = Math.round(totalDist * 2) + route.length * 5; // 2 min/km + 5 min per stop
    
    document.getElementById('routeTotalDistance').innerText = totalDist.toFixed(1);
    document.getElementById('routeTotalTime').innerText = totalTime;
    
    const roadmap = document.getElementById('optimizedRoadmap');
    roadmap.innerHTML = '';
    
    route.forEach((locCode, idx) => {
        let meta = STATIONS_METADATA[locCode];
        let isStart = idx === 0;
        let legDist = idx > 0 ? legs[idx - 1] : 0;
        
        let actions = [];
        activeTasks.forEach(task => {
            if (task.from === locCode) {
                actions.push(`<span style="color:var(--info-color); font-weight:800;"><i class="fa-solid fa-circle-arrow-down"></i> 📥 點收裝車：${task.item} (x${task.qty}盒)</span>`);
            }
            if (task.to === locCode) {
                actions.push(`<span style="color:var(--secondary-color); font-weight:800;"><i class="fa-solid fa-circle-arrow-up"></i> 卸貨簽收點：${task.item} (x${task.qty}盒)</span>`);
            }
        });
        
        let actionText = actions.length > 0 
            ? actions.join('<br>') 
            : `<span style="color:var(--text-muted);"><i class="fa-solid fa-house-chimney"></i> 車隊總部/出發整備點</span>`;
            
        let distLabel = idx > 0 ? `<div class="roadmap-leg">+ ${legDist.toFixed(1)} km (車程約 ${Math.round(legDist * 2)} 分鐘)</div>` : '';
        
        let nodeHtml = `
            ${distLabel}
            <div class="roadmap-node ${isStart ? 'start-node' : ''}">
                <div class="roadmap-circle">${idx + 1}</div>
                <div class="roadmap-content">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h4 style="margin:0; color:var(--primary-color); font-weight:850; font-size:1.1rem;">${meta.name}</h4>
                        <span class="badge ${isStart ? 'badge-info' : 'badge-success'}" style="font-size:0.75rem;">${meta.district}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--text-muted); margin:6px 0 10px 0;"><i class="fa-solid fa-location-dot"></i> ${meta.address}</div>
                    <div class="roadmap-actions">${actionText}</div>
                </div>
            </div>
        `;
        roadmap.innerHTML += nodeHtml;
    });

    // Generate multi-stop Google Maps URL
    let mapsUrl = 'https://www.google.com/maps/dir/';
    route.forEach(locCode => {
        let meta = STATIONS_METADATA[locCode];
        mapsUrl += `${meta.lat},${meta.lng}/`;
    });
    const mapLinkBtn = document.getElementById('multiStopMapLink');
    if (mapLinkBtn) {
        mapLinkBtn.href = mapsUrl;
    }
}

function startOptimizedRoute() {
    let activeTasks = dbRequests.filter(req => req.status === '已核准出庫');
    if (activeTasks.length === 0) {
        showToast("當前無待出發的調撥任務！", "warning");
        return;
    }
    
    activeTasks.forEach(req => {
        req.status = '專車配送中';
        req.dispatchTime = getCurrentTime();
        req.logisticsCondition = '常溫運輸中';
    });
    
    syncToDatabase();
    showToast("🚚 最佳配送路線已啟用！專車已啟程出發配送全線藥物。", "success");
    updateSystemState();
}

// Coordinates and details for Fuxing & Daxi joint network
const STATIONS_METADATA = {
    'DEYI': { name: '德怡藥局', address: '復興區澤仁里忠孝路34號', phone: '(03) 382-1686', hours: '08:30-18:30 (週日休)', lat: 24.8210, lng: 121.3526, district: '復興區' },
    'SHISHENG_FX': { name: '新資生連鎖藥局 (復興店)', address: '大溪區復興路96號', phone: '(03) 388-2206', hours: '08:00-22:00 (全年無休)', lat: 24.8809, lng: 121.2890, district: '大溪區' },
    'GREAT_TREE': { name: '大樹連鎖藥局 (大溪康莊店)', address: '大溪區康莊路160號', phone: '(03) 387-3873', hours: '08:00-22:00 (全年無休)', lat: 24.8801, lng: 121.2872, district: '大溪區' },
    'SHISHENG_KZ': { name: '新資生連鎖藥局 (康莊店)', address: '大溪區康莊路132號', phone: '(03) 388-2276', hours: '08:00-22:00 (全年無休)', lat: 24.8812, lng: 121.2876, district: '大溪區' },
    'ZISHENG': { name: '資生大藥局', address: '大溪區復興路92-1號', phone: '(03) 388-2026', hours: '08:00-21:30 (全年無休)', lat: 24.8810, lng: 121.2889, district: '大溪區' },
    'HQ': { name: '桃園市物流總部 (HQ)', address: '大溪區慈湖路50號', phone: '(03) 388-0000', hours: '24H', lat: 24.8806, lng: 121.2883, district: '大溪區' }
};

// Toast notification helper
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation')}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function getCurrentTime() {
    let d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Dummy Prescription Sheet Builder
function generateDummyPrescriptionBase64(medName, qty) {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    // Background card
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 360, 480);
    
    // Green border
    ctx.strokeStyle = '#0d9488';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 340, 460);
    
    // Decorative medical cross
    ctx.fillStyle = '#ccfbf1';
    ctx.fillRect(300, 20, 40, 40);
    ctx.fillStyle = '#0d9488';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('＋', 308, 48);

    // Title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('衛生福利部中央健康保險署', 30, 45);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#0d9488';
    ctx.fillText('慢性病連續處方箋 (智慧領藥驗證用)', 30, 70);

    // Dividers
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(25, 85); ctx.lineTo(335, 85); ctx.stroke();
    
    // Patient info
    ctx.fillStyle = '#334155';
    ctx.font = '13px sans-serif';
    ctx.fillText('姓名: 王大明 (WANG DA-MING)', 30, 115);
    ctx.fillText('身分證字號: H123456***', 30, 140);
    ctx.fillText('出生日期: 民國 68 年 08 月 23 日', 30, 165);
    ctx.fillText('病歷號碼: L-908234-A', 30, 190);
    
    ctx.beginPath(); ctx.moveTo(25, 210); ctx.lineTo(335, 210); ctx.stroke();
    
    // Medical Diagnosis & Rx Details
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('【開立處方藥品與劑量】', 30, 235);
    
    ctx.fillStyle = '#ef4444';
    ctx.fillText(`[Rx] ${medName}`, 30, 265);
    ctx.fillStyle = '#334155';
    ctx.font = '12px sans-serif';
    ctx.fillText(`總量: ${qty} 盒 (依健保雲端額度核撥)`, 30, 290);
    ctx.fillText(`用法: 每日定時服用，遵照醫囑指示`, 30, 315);
    
    ctx.beginPath(); ctx.moveTo(25, 340); ctx.lineTo(335, 340); ctx.stroke();
    
    // Signature and Stamp
    ctx.font = '12px sans-serif';
    ctx.fillText('開立機構: 林口長庚紀念醫院 (特約代號: 1132010011)', 30, 365);
    ctx.fillText('主治醫師: 陳宗賢 醫師 (簽章已電子核備)', 30, 390);
    
    // Stamp box
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(240, 395, 75, 55);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('長庚紀念醫院', 246, 418);
    ctx.fillText('院外慢箋專用', 246, 438);
    
    return canvas.toDataURL('image/jpeg');
}

// Drag & drop handlers
function setupDragAndDrop() {
    const zone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('prescriptionFile');
    if (!zone || !fileInput) return;

    zone.addEventListener('click', () => fileInput.click());
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect(fileInput);
        }
    });
}

function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const max_width = 300;
            const scale = max_width / img.width;
            if (img.width > max_width) {
                canvas.width = max_width;
                canvas.height = img.height * scale;
            } else {
                canvas.width = img.width;
                canvas.height = img.height;
            }
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Compress image to JPEG at 70% quality
            tempPrescriptionImgBase64 = canvas.toDataURL('image/jpeg', 0.7);
            isCustomUploaded = true; // Mark as custom uploaded!
            const preview = document.getElementById('uploadPreview');
            if (preview) {
                preview.src = tempPrescriptionImgBase64;
                preview.style.display = 'block';
                showToast("成功上傳並壓縮處方箋照片！", "success");
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function fillTestAccount(user) {
    const userEl = document.getElementById('loginUser');
    const pwdEl = document.getElementById('loginPwd');
    if (userEl && pwdEl) {
        userEl.value = user;
        pwdEl.value = '123';
        showToast(`已載入帳號: ${user}，正在登入...`, 'success');
        setTimeout(() => {
            doLogin();
        }, 400);
    }
}

// Authentication login routing
function doLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pwd = document.getElementById('loginPwd').value;
    if (pwd !== '123') { showToast('密碼錯誤！(測試用密碼為 123)', 'error'); return; }
    
    if (user === 'wang') loginAs('buyer', 'none', '王大明');
    else if (user === 'deyi_wang') loginAs('pharmacist', 'DEYI', '德怡藥局');
    else if (user === 'daxi_lin') loginAs('pharmacist', 'SHISHENG_FX', '新資生復興店');
    else if (user === 'daxi_kz') loginAs('pharmacist', 'SHISHENG_KZ', '新資生康莊店');
    else if (user === 'daxi_tree') loginAs('pharmacist', 'GREAT_TREE', '大樹藥局康莊店');
    else if (user === 'daxi_zisheng') loginAs('pharmacist', 'ZISHENG', '資生大藥局');
    else if (user === 'admin') loginAs('admin', 'HQ', '桃園市衛生局管理者/復興區長');
    else if (user === 'driver') loginAs('driver', 'TRUCK', '物流調撥司機');
    else showToast('查無此帳號！請參考說明。', 'error');
}

function loginAs(role, sCode, dName) {
    currentRole = role; 
    currentStation = sCode; 
    currentStationName = dName;
    
    document.getElementById('display-name').innerText = dName;
    document.getElementById('display-role').innerText = role === 'buyer' ? '復興區居民' : (role === 'pharmacist' ? '特約藥局藥師' : (role === 'driver' ? '物流專車司機' : '衛生局主管/區長'));
    
    document.querySelectorAll('.nav-list .nav-item').forEach(item => {
        item.classList.contains('role-' + role) ? item.classList.add('show') : item.classList.remove('show');
    });
    
    document.getElementById('login-screen').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('login-screen').style.visibility = 'hidden';
        switchPage(role === 'buyer' ? 'buyer-dash' : (role === 'pharmacist' ? 'pharm-dash' : (role === 'driver' ? 'driver-dash' : 'admin-dash')), '主選單');
        fetchSystemData();
    }, 400);
}

function logout() {
    document.getElementById('loginUser').value = ''; 
    document.getElementById('loginPwd').value = '';
    const ls = document.getElementById('login-screen'); 
    ls.style.visibility = 'visible'; 
    ls.style.opacity = '1';
}

async function resetSystemData() {
    if (confirm("確定要重設所有庫存、預約與物流調撥紀錄嗎？這會清除您所有的自訂測試資料並恢復初始預設狀態。")) {
        localStorage.removeItem('SmartPharma_Requests');
        localStorage.removeItem('SmartPharma_Inventory');
        try {
            await fetch('/api/reset', { method: 'POST' });
        } catch (e) {
            console.error("Reset API failed:", e);
        }
        location.reload();
    }
}

// Fetch DB & LocalStorage data
function seedMockRequests() {
    return [];
}

function getDrugCategory(item) {
    if (item.usageCategory) return item.usageCategory;
    const name = item.drugChineseName || '';
    if (name.includes('克流感') || name.includes('伊普芬液') || name.includes('倍拉維') || name.includes('Paxlovid') || name.includes('Tamiflu')) {
        return '緊急用';
    }
    return '日常用';
}

async function fetchSystemData() {
    try {
        const invRes = await fetch('/api/inventory');
        dbInventory = await invRes.json();
        
        dbInventory.forEach(item => {
            item.usageCategory = getDrugCategory(item);
        });

        const reqRes = await fetch('/api/requests');
        dbRequests = await reqRes.json();
        
        if (!dbRequests || dbRequests.length === 0) {
            dbRequests = seedMockRequests();
        }
        
        // 實作企劃書 4.2 預期成果：前端 LocalStorage 暫存設計
        localStorage.setItem('SmartPharma_Inventory', JSON.stringify(dbInventory));
        localStorage.setItem('SmartPharma_Requests', JSON.stringify(dbRequests));
        console.log("資料已同步至前端 LocalStorage 暫存");
        
    } catch (e) {
        console.error("無法連線至後端資料庫，啟動前端 LocalStorage 離線備援機制:", e);
        
        // 如果網路斷線或後端無回應，使用 LocalStorage 暫存資料
        const localInv = localStorage.getItem('SmartPharma_Inventory');
        const localReq = localStorage.getItem('SmartPharma_Requests');
        
        if (localInv && localReq) {
            dbInventory = JSON.parse(localInv);
            dbRequests = JSON.parse(localReq);
            dbInventory.forEach(item => { item.usageCategory = getDrugCategory(item); });
            showToast("網路連線異常，已自動切換為前端 LocalStorage 離線暫存模式", "warning");
        } else {
            showToast("資料庫連線失敗，且無本地暫存資料", "error");
        }
    }
    
    updateSystemState();
    fetchRealTimeWeather(true);
}

function triggerReservationFlow(drugCode, stationCode, isRx) {
    let targetMed = dbInventory.find(m => m.drugCode === drugCode);
    let drugChineseName = targetMed ? targetMed.drugChineseName : 'Unknown';
    let uPrice = targetMed ? targetMed.price : 150;
    
    // Check if prescription uploaded for Rx drugs
    if (isRx && (!tempPrescriptionImgBase64 || !isCustomUploaded)) {
        tempPrescriptionImgBase64 = generateDummyPrescriptionBase64(drugChineseName, 1);
        const preview = document.getElementById('uploadPreview');
        if (preview) {
            preview.src = tempPrescriptionImgBase64;
            preview.style.display = 'block';
        }
        showToast("已自動為您載入/更新成分相符之電子慢箋憑證！", "success");
    }

    tempReserveData = {
        item: drugChineseName,
        drugCode: targetMed ? targetMed.drugCode : '',
        station: stationCode,
        unitPrice: uPrice,
        qty: 1,
        totalPrice: uPrice,
        prescriptionImg: isRx ? tempPrescriptionImgBase64 : ''
    };
    
    if (isRx) {
        document.getElementById('nhiModal').style.display = 'flex';
        document.getElementById('nhiSuccessMsg').style.display = 'none';
        setTimeout(() => { document.getElementById('nhiProgressBar').style.width = '100%'; }, 100);
        setTimeout(() => {
            document.getElementById('nhiSuccessMsg').style.display = 'block';
            setTimeout(() => {
                document.getElementById('nhiModal').style.display = 'none'; 
                document.getElementById('nhiProgressBar').style.width = '0%'; 
                showPaymentModal();
            }, 1200); 
        }, 1500);
    } else { 
        showPaymentModal(); 
    }
}

function buyerSubmitReservation() {
    const drugName = document.getElementById('buyerReserveDrug').value;
    const stationCode = document.getElementById('buyerReserveStation').value;
    
    const med = dbInventory.find(m => m.drugChineseName === drugName);
    if (!med) {
        showToast("找不到該藥品資料！", "error");
        return;
    }
    const isRx = med ? med.rxOnly : false;
    
    triggerReservationFlow(med.drugCode, stationCode, isRx);
}

function showPaymentModal() {
    document.getElementById('payItemName').innerText = tempReserveData.item;
    document.getElementById('payItemUnitPrice').innerText = tempReserveData.unitPrice;
    document.getElementById('reserveQtyInput').value = 1;
    document.getElementById('payItemTotalPrice').innerText = tempReserveData.unitPrice;
    
    let localStr = new Date(Date.now() + 8*3600*1000 + 30*60*1000).toISOString().slice(0, 16);
    document.getElementById('pickupTimeInput').value = localStr;
    document.getElementById('paymentModal').style.display = 'flex';
    checkSubstitution();
}

function updateTotalPrice() {
    let q = parseInt(document.getElementById('reserveQtyInput').value) || 1;
    if (q < 1) { q = 1; document.getElementById('reserveQtyInput').value = 1; }
    tempReserveData.qty = q;
    tempReserveData.totalPrice = q * tempReserveData.unitPrice;
    document.getElementById('payItemTotalPrice').innerText = tempReserveData.totalPrice;
    
    // Regenerate prescription template to match quantity
    if (tempReserveData.prescriptionImg && !isCustomUploaded) {
        tempReserveData.prescriptionImg = generateDummyPrescriptionBase64(tempReserveData.item, q);
    }
    checkSubstitution();
}

function closePaymentModal() { document.getElementById('paymentModal').style.display = 'none'; }

function processPaymentBranch() {
    let pTime = document.getElementById('pickupTimeInput').value;
    if (!pTime) { showToast("請選取預約取藥時間！", "warning"); return; }
    updateTotalPrice(); 
    tempReserveData.pickupTime = pTime.replace("T", " ");
    let pMethod = document.querySelector('input[name="payMethod"]:checked').value;
    tempReserveData.payment = pMethod;
    closePaymentModal();
    
    if (pMethod === "信用卡線上刷卡") { 
        document.getElementById('creditCardModal').style.display = 'flex'; 
    } else { 
        tempReserveData.paidStatus = "未支付"; 
        executeReservationAPI(); 
    }
}

function closeCreditCardModal() { document.getElementById('creditCardModal').style.display = 'none'; }
function simulateCardAuthorization() {
    closeCreditCardModal(); 
    let successText = document.getElementById('successModalText');
    if (successText) successText.innerText = "刷卡金流授權成功";
    document.getElementById('successModal').style.display = 'flex';
    setTimeout(() => { 
        document.getElementById('successModal').style.display = 'none'; 
        tempReserveData.paidStatus = "已線上支付"; 
        executeReservationAPI(); 
    }, 1800);
}

// Core reservation submission with automatic shuttle routing if low stock
async function executeReservationAPI() {
    let med = dbInventory.find(m => m.drugCode === tempReserveData.drugCode);
    if (!med) return;
    
    let targetStationStockField = 'stock_' + tempReserveData.station;
    let availableStock = med[targetStationStockField] || 0;
    
    let needTransfer = false;
    let transferFromStation = '';
    
    // Check if we need to dispatch a shuttle from Daxi district
    if (availableStock < tempReserveData.qty) {
        needTransfer = true;
        
        let thresh = getSafetyStockThreshold(med);
        let reqQty = tempReserveData.qty;
        let destStation = tempReserveData.station;

        let bestSafeStation = null;
        let minSafeDist = Infinity;
        
        let bestAvailableStation = null;
        let minAvailableDist = Infinity;

        let fallbackStation = null;
        let minFallbackDist = Infinity;

        Object.keys(STATIONS_METADATA).forEach(code => {
            if (STATIONS_METADATA[code].district === '大溪區' && code !== destStation) {
                let stock = med['stock_' + code] || 0;
                let dist = getDistance(destStation, code);
                
                if (stock >= reqQty + thresh) {
                    if (dist < minSafeDist) { minSafeDist = dist; bestSafeStation = code; }
                } else if (stock >= reqQty) {
                    if (dist < minAvailableDist) { minAvailableDist = dist; bestAvailableStation = code; }
                }
                
                if (dist < minFallbackDist) { minFallbackDist = dist; fallbackStation = code; }
            }
        });

        if (bestSafeStation) {
            transferFromStation = bestSafeStation;
        } else if (bestAvailableStation) {
            transferFromStation = bestAvailableStation;
        } else {
            transferFromStation = fallbackStation || 'GREAT_TREE';
        }
        
        showToast("🏪 本店庫存不足，系統已為您自動配對大溪支援藥局，啟動聯合專車調度中！", "warning");
    }

    let reserveId = "RES-" + Math.floor(Math.random() * 9000 + 1000);
    let rxStatus = tempReserveData.prescriptionImg ? "待核實" : "免核驗";
    
    // Deduct stock or generate dispatch
    if (!needTransfer) {
        med[targetStationStockField] = Math.max(0, med[targetStationStockField] - tempReserveData.qty);
    }

    let newReservation = {
        id: reserveId,
        from: "民眾",
        to: tempReserveData.station,
        item: tempReserveData.item,
        drugCode: tempReserveData.drugCode,
        qty: tempReserveData.qty,
        status: needTransfer ? "同業調撥中" : "待核備領取",
        time: getCurrentTime(),
        payment: tempReserveData.payment,
        pickupTime: tempReserveData.pickupTime,
        paidStatus: tempReserveData.paidStatus,
        price: tempReserveData.totalPrice,
        prescriptionImg: tempReserveData.prescriptionImg,
        prescriptionStatus: rxStatus
    };

    dbRequests.push(newReservation);

    if (needTransfer) {
        // Create matching peer-to-peer shuttle transfer request
        let reqId = "REQ-" + Math.floor(Math.random() * 9000 + 1000);
        let transferReq = {
            id: reqId,
            relatedReserveId: reserveId,
            from: transferFromStation,
            to: tempReserveData.station,
            item: tempReserveData.item,
            drugCode: tempReserveData.drugCode,
            qty: tempReserveData.qty,
            status: "待審核",
            time: getCurrentTime(),
            targetTime: tempReserveData.pickupTime,
            dispatchTime: '待審核',
            logisticsCondition: '待發貨'
        };
        dbRequests.push(transferReq);
    }

    try {
        syncToDatabase();
    } catch (error) {
        console.error("LocalStorage write failed:", error);
        showToast("⚠️ 儲存空間已滿，預約儲存失敗！請點擊右上角「重設資料」以清理空間。", "error");
        return;
    }
    
    // Reset uploader
    tempPrescriptionImgBase64 = '';
    isCustomUploaded = false;
    const preview = document.getElementById('uploadPreview');
    if (preview) preview.style.display = 'none';

    showToast("預約慢箋資料提交成功！", "success");
    updateSystemState();

    let successText = document.getElementById('successModalText');
    if (successText) successText.innerText = "預約完成！";
    document.getElementById('successModal').style.display = 'flex';
    setTimeout(() => { 
        document.getElementById('successModal').style.display = 'none'; 
    }, 2000);
}

// Pharmacist actions
function openPrescriptionVerifyModal(reqId) {
    let req = dbRequests.find(r => r.id === reqId);
    if (!req || !req.prescriptionImg) return;
    activeViewPrescriptionId = reqId;
    document.getElementById('modalPrescriptionImg').src = req.prescriptionImg;
    document.getElementById('prescriptionViewModal').style.display = 'flex';
}

function closePrescriptionViewModal() {
    document.getElementById('prescriptionViewModal').style.display = 'none';
    activeViewPrescriptionId = null;
}

function verifyPrescriptionAction(status) {
    if (!activeViewPrescriptionId) return;
    let req = dbRequests.find(r => r.id === activeViewPrescriptionId);
    if (req) {
        req.prescriptionStatus = status;
        if (status === '已核實核發' && req.status === '待核備領取') {
            req.status = '待領取';
            showToast(`處方已驗證核准！開始進行藥包整備。`, 'success');
        } else if (status === '核實遭退回') {
            req.status = '核實遭退回';
            showToast(`已退回該預約。`, 'error');
            // rollback inventory
            let med = dbInventory.find(m => m.drugChineseName === req.item);
            if (med) {
                let stockField = 'stock_' + req.to;
                med[stockField] += req.qty;
                syncToDatabase();
            }
        }
        syncToDatabase();
        closePrescriptionViewModal();
        updateSystemState();
    }
}

function apiCompleteReservation(reqId) {
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        r.status = '已領藥結案';
        r.paidStatus = '已支付';
        syncToDatabase();
        showToast(`發藥完成，交易結案！`, 'success');
        updateSystemState();
    }
}

function apiCancelReservation(reqId) {
    if (!confirm('確認取消此預約並回滾安全庫存？')) return;
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        r.status = '已取消';
        let med = dbInventory.find(m => m.drugChineseName === r.item);
        if (med) {
            let stockField = 'stock_' + r.to;
            med[stockField] += r.qty;
            syncToDatabase();
        }
        syncToDatabase();
        showToast(`預約已取消！`, 'warning');
        updateSystemState();
    }
}

function deleteReservation(id) {
    if (!confirm("確定要刪除此預約紀錄嗎？此動作將同時刪除與其相關聯的所有調撥物流請求。")) {
        return;
    }
    // Delete reservation from dbRequests
    dbRequests = dbRequests.filter(req => req.id !== id);
    // Cascade delete any linked transfer requests matching relatedReserveId
    dbRequests = dbRequests.filter(req => req.relatedReserveId !== id);
    
    try {
        syncToDatabase();
        showToast("已成功刪除預約紀錄及關聯調撥單！", "success");
    } catch (e) {
        showToast("儲存失敗，請重設資料後再試", "error");
    }
    
    updateSystemState();
}

function deleteTransfer(id) {
    if (!confirm("確定要刪除此調撥紀錄嗎？")) {
        return;
    }
    dbRequests = dbRequests.filter(req => req.id !== id);
    
    try {
        syncToDatabase();
        showToast("已成功刪除調撥紀錄！", "success");
    } catch (e) {
        showToast("儲存失敗，請重設資料後再試", "error");
    }
    
    updateSystemState();
}

// Peer-to-peer transfer dialog
function openTransferModal(drugCode) {
    let med = dbInventory.find(m => m.drugCode === drugCode);
    if (!med) return;
    let drugChineseName = med.drugChineseName;
    tempTransferData = { item: drugChineseName, drugCode: med.drugCode };
    document.getElementById('transferItemName').innerText = drugChineseName;

    // Calculate distances and gather candidates
    let candidates = [];
    Object.keys(STATIONS_METADATA).forEach(code => {
        if (code !== currentStation && code !== 'HQ' && code !== 'TRUCK') {
            let meta = STATIONS_METADATA[code];
            
            // RULE: Daxi pharmacies CANNOT request transfers from Fuxing pharmacies
            let currentMeta = STATIONS_METADATA[currentStation];
            if (currentMeta && currentMeta.district === '大溪區' && meta.district === '復興區') {
                return; // Skip Fuxing pharmacy as donor
            }

            let currentStock = med['stock_' + code] || 0;
            if (currentStock < 10) {
                return; // SKIP: Do not allow transfer from a pharmacy that is at or below safety stock
            }
            
            let distance = getDistance(currentStation, code);
            candidates.push({
                code: code,
                meta: meta,
                stock: currentStock,
                distance: distance
            });
        }
    });

    // Sort candidates by distance (closest first)
    candidates.sort((a, b) => a.distance - b.distance);

    let optionsHtml = '';
    candidates.forEach(cand => {
        let code = cand.code;
        let meta = cand.meta;
        let dist = cand.distance;
        let currentStock = cand.stock;
        
        let distStr = dist > 0 ? `${dist.toFixed(1)} km` : '0.0 km';
        
        optionsHtml += `
            <label class="payment-method">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                    <input type="radio" name="transferTarget" value="${code}">
                    <i class="fa-solid fa-store" style="color: var(--secondary-color); font-size: 1.2rem; flex-shrink: 0;"></i> 
                    <div style="min-width: 0;">
                        <span style="font-weight: 750; color: var(--primary-color); font-size: 0.95rem; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${meta.name}</span>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
                            ${meta.district} | 剩餘庫存: <strong style="color: ${currentStock > 0 ? 'var(--secondary-color)' : 'var(--danger-color)'}; font-weight: 800;">${currentStock}</strong> 盒
                        </div>
                    </div>
                </div>
                <span class="badge" style="font-size: 0.8rem; font-weight: 800; background: var(--info-light); color: var(--info-color); border: 1px solid rgba(37, 99, 235, 0.15); display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px; padding: 6px 12px; flex-shrink: 0;">
                    <i class="fa-solid fa-map-pin"></i> 距離 ${distStr}
                </span>
            </label>
        `;
    });

    document.getElementById('transferTargetOptions').innerHTML = optionsHtml;
    document.getElementById('transferQtyInput').value = 5; 
    document.getElementById('transferModal').style.display = 'flex';
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
}

function submitTransferRequest() {
    let checkedRadio = document.querySelector('input[name="transferTarget"]:checked');
    if (!checkedRadio) { showToast("請選取支援藥局！", "warning"); return; }
    
    let targetStation = checkedRadio.value;
    let qty = parseInt(document.getElementById('transferQtyInput').value) || 1;
    let targetTime = document.getElementById('transferTargetTime').value;
    let timeStr = targetTime ? targetTime.replace('T', ' ') : '無指定';
    
    closeTransferModal();

    let reqId = "REQ-" + Math.floor(Math.random() * 9000 + 1000);
    dbRequests.push({
        id: reqId,
        from: targetStation, // Donor station
        to: currentStation, // Receiver station
        item: tempTransferData.item,
        drugCode: tempTransferData.drugCode,
        qty: qty,
        status: "待審核",
        time: getCurrentTime(),
        targetTime: timeStr,
        dispatchTime: '待審核',
        logisticsCondition: '待發貨'
    });
    
    syncToDatabase();
    showToast(`成功向 ${STATIONS_METADATA[targetStation].name} 發出調度申請！`, 'success');
    updateSystemState();
}

function apiApproveRequest(reqId) {
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        let med = dbInventory.find(m => m.drugChineseName === r.item);
        if (med) {
            let fromField = 'stock_' + r.from;
            let currentStock = med[fromField] || 0;
            let thresh = getSafetyStockThreshold(med);
            let maxSpare = currentStock - thresh;
            
            if (maxSpare <= 0) {
                showToast(`無法核准！該藥品自身庫存已達安全預警水位 (${currentStock} / ${thresh})，無法再提供調撥。`, 'error');
                return; // Stop approval
            }
            
            if (r.qty > maxSpare) {
                let originalQty = r.qty;
                r.qty = maxSpare;
                showToast(`庫存保護機制：原申請 ${originalQty} 盒，為維持自身安全水位，系統自動下修核准量為 ${maxSpare} 盒。`, 'warning');
            } else {
                showToast(`核准調撥！請等待車隊收件。`, 'success');
            }
            
            med[fromField] = Math.max(0, med[fromField] - r.qty); // Deduct from donor
        } else {
            showToast(`核准調撥！請等待車隊收件。`, 'success');
        }

        r.status = '已核准出庫';
        r.dispatchTime = '準備派車';
        r.logisticsCondition = '常溫運輸中';
        
        syncToDatabase();
        updateSystemState();
    }
}

function apiRejectRequest(reqId) {
    if (!confirm('確定退回此申請？')) return;
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        r.status = '已退回';
        syncToDatabase();
        showToast(`已拒絕調撥請求。`, 'warning');
        updateSystemState();
    }
}

// Switch dashboard page
function switchPage(pageId, pageTitle) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active')); 
    document.querySelectorAll('.nav-list .nav-item').forEach(n => n.classList.remove('active'));
    
    const pageElement = document.getElementById(pageId);
    if(pageElement) pageElement.classList.add('active');
    
    if (event && event.currentTarget && event.currentTarget.classList) {
        event.currentTarget.classList.add('active');
    }
    document.getElementById('header-title').innerText = pageTitle;

    const weatherCard = document.getElementById('shared-weather-card');
    if (weatherCard) {
        if (currentRole === 'pharmacist' || currentRole === 'admin') {
            weatherCard.style.display = 'flex';
        } else {
            weatherCard.style.display = 'none';
        }
    }
}

function filterTable() { 
    renderInventoryTable(); 
}

// Master state updates & rendering
function updateSystemState() {
    renderInventoryTable(); 
    renderInboxTable(); 
    renderReservationTable(); 
    renderBuyerOrderTable();
    renderPharmacyHours();
    

    if (currentRole === 'driver') {
        renderDriverTasks();
        optimizeDriverRoute();
        
        let activeTask = dbRequests.find(req => req.status === '專車配送中');
        if (activeTask) {
            if (!liveNavInterval) {
                startLiveNavigationLoop(activeTask);
            }
        } else {
            if (liveNavInterval) {
                stopLiveNavigationLoop();
            }
        }
    } else {
        if (liveNavInterval) {
            stopLiveNavigationLoop();
        }
    }
    if (currentRole === 'admin') { 
        renderAdminCharts(); 
        renderAdminTransferTable(); 
    }
    if (currentRole === 'pharmacist') {
        renderPharmTransferTable();
    }
    
    let myStockField = 'stock_' + currentStation;
    let urgentCount = 0;
    let globalUrgentCount = 0;
    
    dbInventory.forEach(item => {
        let itemThresh = getSafetyStockThreshold(item);
        let currentStock = item[myStockField] || 0;
        if (currentStock < itemThresh) {
            urgentCount++;
            if (currentRole === 'pharmacist' && currentStation !== 'HQ') {
                autoTriggerRestock(item, currentStation, itemThresh - currentStock);
            }
        }
        // Calculate global urgent count for admin
        ['DEYI', 'SHISHENG_FX', 'GREAT_TREE', 'SHISHENG_KZ', 'ZISHENG'].forEach(st => {
            if ((item['stock_' + st] || 0) < itemThresh) {
                globalUrgentCount++;
            }
        });
    });

    let displayThresh = getSafetyStockThreshold();
    let todoCount = dbRequests.filter(req => req.from === currentStation && req.status === '待審核').length;
    let resCount = dbRequests.filter(req => req.to === currentStation && req.from === '民眾' && (req.prescriptionStatus === '待核實' || req.status === '同業調撥中')).length;
    
    if (document.getElementById('dash-urgent-count')) {
        document.getElementById('dash-urgent-count').innerText = urgentCount;
        let urgentTitle = document.getElementById('dash-urgent-count').previousElementSibling;
        if (urgentTitle) {
            urgentTitle.innerText = `安全水位告急 (依預測標準)`;
        }
    }
    if (document.getElementById('dash-admin-urgent-count')) {
        document.getElementById('dash-admin-urgent-count').innerText = globalUrgentCount;
    }
    if (document.getElementById('dash-todo-count')) document.getElementById('dash-todo-count').innerText = todoCount;
    if (document.getElementById('dash-res-count')) document.getElementById('dash-res-count').innerText = resCount;

    let aiCard = document.getElementById('aiAdjustmentCard'); 
    let aiText = document.getElementById('aiAdjustmentText');
    if (aiCard && aiText && currentRole === 'pharmacist') {
        let factor = currentWeatherMode === 'rainy' ? '1.5' : (currentWeatherMode === 'typhoon' ? '2.0' : '1.0');
        let modeChinese = currentWeatherMode === 'rainy' ? '大雨特報' : (currentWeatherMode === 'typhoon' ? '颱風警戒' : '晴朗常態');
        let futureOrders = dbRequests.filter(req => req.to === currentStation && req.from === '民眾' && (req.status === '待領取' || req.status === '待核備領取'));
        
        if (currentWeatherMode !== 'sunny' || futureOrders.length > 0) {
            aiCard.style.backgroundColor = '#fff1f2'; 
            aiCard.style.borderTop = '4px solid var(--danger-color)';
            aiText.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-color);"></i> <b>AI 庫存防缺預警 (${modeChinese})：</b> 當前安全水位基準調整為 <b>${displayThresh} 盒 (${factor}x)</b>。<br>本店目前有 <b>${futureOrders.length} 筆</b> 慢箋預約排程。AI已依季節性分佈主動調升防汛儲備，並對接大溪聯合物流儲運！`;
        } else {
            aiCard.style.backgroundColor = '#f0fdfa'; 
            aiCard.style.borderTop = '4px solid var(--secondary-color)';
            aiText.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--secondary-color);"></i> 全區用藥消耗與氣象預報 (${modeChinese}) 皆在安全界限內，庫存維持基準 <b>${displayThresh} 盒 (1.0x)</b>。`;
        }
    }
    
    const badge = document.getElementById('inbox-badge'); 
    if (badge) { 
        if (todoCount > 0) { 
            badge.innerText = todoCount; 
            badge.style.display = 'inline-block'; 
        } else { 
            badge.style.display = 'none'; 
        } 
    }
}

// Render joint pharmacy hours
function renderPharmacyHours() {
    const grid = document.getElementById('pharmacyHoursGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    Object.keys(STATIONS_METADATA).forEach(code => {
        if (code === 'HQ' || code === 'TRUCK') return;
        let p = STATIONS_METADATA[code];
        let card = document.createElement('div');
        card.className = 'pharmacy-hours-card';
        
        let isOpen = code === 'DEYI' || p.hours.includes('全年無休') ? '<span class="badge badge-success">營業中</span>' : '<span class="badge badge-warning">預約排程</span>';
        
        card.innerHTML = `
            <div class="pharmacy-hours-name">${p.name} ${isOpen}</div>
            <div class="pharmacy-hours-detail"><b>📍 據點地址:</b> ${p.address}</div>
            <div class="pharmacy-hours-detail"><b>📞 連絡電話:</b> ${p.phone}</div>
            <div class="pharmacy-hours-detail"><b>⏰ 營業時間:</b> ${p.hours}</div>
        `;
        grid.appendChild(card);
    });
}

function setInventoryFilter(filterType) {
    currentInventoryFilter = filterType;
    const tabs = {
        'all': 'tab-all',
        'daily': 'tab-daily',
        'emergency': 'tab-emergency'
    };
    Object.keys(tabs).forEach(k => {
        const btn = document.getElementById(tabs[k]);
        if (btn) {
            if (k === filterType) {
                btn.style.background = 'white';
                btn.style.color = 'var(--primary-color)';
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-muted)';
                btn.style.boxShadow = 'none';
            }
        }
    });
    renderInventoryTable();
}

// Render dynamic stock tables matching INAE3000S01 columns
function renderInventoryTable() {
    const thead = document.getElementById('inventoryThead');
    const tbody = document.querySelector('#inventoryTable tbody'); 
    if (!tbody || !thead) return; 

    // Threshold is calculated per-item now

    // Generate table header depending on user role
    let thHtml = `<tr><th>健保藥碼 / ATC</th><th>藥品品名及屬性</th><th>自付額</th>`;
    if (currentRole === 'buyer') {
        thHtml += `<th>德怡藥局(復興)</th>`;
    } else {
        // admin, driver, or pharmacist
        thHtml += `<th>德怡(復興)</th><th>新資生復興(大溪)</th><th>大樹康莊(大溪)</th><th>新資生康莊(大溪)</th><th>資生(大溪)</th>`;
    }
    thHtml += `<th>用途分類</th><th>跨店調撥與預約決策</th></tr>`;
    thead.innerHTML = thHtml;

    tbody.innerHTML = '';
    const kw = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : '';
    
    dbInventory.filter(item => {
        // Keyword text match
        const matchKw = item.drugChineseName.toLowerCase().includes(kw) || 
                        item.drugCode.toLowerCase().includes(kw) ||
                        item.atcCode.toLowerCase().includes(kw);
        if (!matchKw) return false;
        
        // Category filter match
        const category = getDrugCategory(item);
        if (currentInventoryFilter === 'daily') {
            return category === '日常用';
        } else if (currentInventoryFilter === 'emergency') {
            return category === '緊急用';
        }
        return true;
    }).forEach(item => {
        let itemThresh = getSafetyStockThreshold(item);
        let actionBtn = '';
        if (currentRole === 'buyer') {
            actionBtn = `
                <div style="display:flex; gap:5px; flex-direction:column;">
                    <button class="btn btn-info" style="font-size:0.75rem;padding:4px 8px;" onclick="triggerReservationFlow('${item.drugCode}', 'DEYI', ${item.rxOnly})">預約德怡</button>
                </div>
            `;
        } else if (currentRole === 'pharmacist') {
            let myStock = item['stock_' + currentStation] || 0;
            actionBtn = myStock < itemThresh 
                ? `<button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem;" onclick="openTransferModal('${item.drugCode}')"><i class="fa-solid fa-truck-ramp-box"></i> 告急求援</button>` 
                : `<button class="btn btn-primary" style="padding:6px 12px;font-size:0.8rem; background:var(--primary-light);" onclick="openTransferModal('${item.drugCode}')"><i class="fa-solid fa-boxes-stacked"></i> 調撥庫存</button>`;
        } else if (currentRole === 'admin') { 
            actionBtn = `<button class="btn btn-primary" style="background:#475569;padding:6px 12px;font-size:0.8rem;" onclick="showFlowLog('${item.drugCode}')">審計稽核</button>`; 
        }

        let nameHtml = item.rxOnly 
            ? `<strong>${item.drugChineseName}</strong> <br><small style="color:var(--text-muted);">${item.drugEnglishName}</small> <span class="badge badge-danger" style="font-size:0.65rem; padding:2px 6px;">Rx 處方箋藥</span>` 
            : `<strong>${item.drugChineseName}</strong> <br><small style="color:var(--text-muted);">${item.drugEnglishName}</small> <span class="badge badge-success" style="font-size:0.65rem; padding:2px 6px;">OTC 成藥</span>`;
        
        let stockCells = '';
        if (currentRole === 'buyer') {
            stockCells = `
                <td style="${item.stock_DEYI < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_DEYI} 盒</td>
            `;
        } else {
            stockCells = `
                <td style="${item.stock_DEYI < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_DEYI} 盒</td>
                <td style="${item.stock_SHISHENG_FX < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_SHISHENG_FX} 盒</td>
                <td style="${item.stock_GREAT_TREE < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_GREAT_TREE} 盒</td>
                <td style="${item.stock_SHISHENG_KZ < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_SHISHENG_KZ} 盒</td>
                <td style="${item.stock_ZISHENG < itemThresh ? 'color:var(--danger-color);font-weight:bold;' : ''}">${item.stock_ZISHENG} 盒</td>
            `;
        }

        const category = getDrugCategory(item);
        let categoryBadge = '';
        if (category === '緊急用') {
            categoryBadge = `<span class="badge" style="background:#fff1f2; color:#e11d48; font-weight:800;"><i class="fa-solid fa-kit-medical"></i> 緊急用</span>`;
        } else {
            categoryBadge = `<span class="badge" style="background:#f0fdf4; color:#16a34a; font-weight:800;"><i class="fa-solid fa-calendar-day"></i> 日常用</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${item.drugCode}</code><br><small style="color:var(--text-muted);">${item.atcCode}</small></td>
            <td>${nameHtml}</td>
            <td style="font-weight:bold; color:var(--text-dark);">$ ${item.price}</td>
            ${stockCells}
            <td>${categoryBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Render resident reservations & transport stepper
function renderBuyerOrderTable() {
    const tbody = document.querySelector('#buyerOrderTable tbody'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    let myOrders = dbRequests.filter(req => req.from === '民眾');
    if (myOrders.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding: 30px;">目前無慢箋預約紀錄。</td></tr>`; 
        return; 
    }
    
    myOrders.forEach(req => {
        let pName = STATIONS_METADATA[req.to] ? STATIONS_METADATA[req.to].name : req.to;
        let paidBadge = req.paidStatus.includes('已') 
            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> ${req.paidStatus}</span>` 
            : `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> ${req.paidStatus}</span>`;
            
        let rxImgBadge = req.prescriptionImg 
            ? `<span class="badge badge-info" style="cursor:pointer;" onclick="viewOnlyPrescription('${req.id}')"><i class="fa-solid fa-image"></i> 查看處方簽名</span>` 
            : `<span class="badge badge-success">免憑證</span>`;

        // Check if there is an active peer-to-peer shuttle transfer linked
        let linkedTransfer = dbRequests.find(t => t.relatedReserveId === req.id);
        
        let statusBadge = '';
        let stepperHtml = '';
        
        if (linkedTransfer) {
            // Low stock, shuttle transport routing activated!
            if (linkedTransfer.status === '待審核') {
                statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> 調撥待確認</span>`;
                stepperHtml = generateStepperMarkup(2, '等待支援藥局確認調撥');
            } else if (linkedTransfer.status === '已核准出庫') {
                statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-truck-ramp-box"></i> 大溪配送中</span>`;
                stepperHtml = generateStepperMarkup(3, '大溪調度專車配送中');
            } else if (linkedTransfer.status === '專車配送中') {
                statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-truck fa-spin"></i> 物流運送中</span>`;
                stepperHtml = generateStepperMarkup(3, `物流車運行中`);
            } else if (linkedTransfer.status === '已送達簽收') {
                statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-store"></i> 已送達待領</span>`;
                stepperHtml = generateStepperMarkup(4, '藥品已送達德怡藥局');
            } else if (linkedTransfer.status === '已退回') {
                statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> 調撥被拒絕</span>`;
                stepperHtml = '<div style="color:var(--danger-color); font-size:0.8rem; font-weight:bold;">❌ 支援藥局拒絕調撥，請聯絡藥局！</div>';
            }
        } else {
            // Standard direct stock
            if (req.prescriptionStatus === '待核實') {
                statusBadge = `<span class="badge badge-warning">處方審查中</span>`;
                stepperHtml = generateStepperMarkup(1, '待德怡藥師照片核備');
            } else if (req.prescriptionStatus === '已核實核發' && req.status !== '已領藥結案') {
                statusBadge = `<span class="badge badge-info">備藥中</span>`;
                stepperHtml = generateStepperMarkup(2, '藥師核實，正在配藥');
            } else if (req.status === '已領藥結案') {
                statusBadge = `<span class="badge badge-success">領藥結案</span>`;
                stepperHtml = generateStepperMarkup(4, '已領藥結案');
            } else if (req.status === '核實遭退回') {
                statusBadge = `<span class="badge badge-danger">審查未通過</span>`;
                stepperHtml = '<div style="color:var(--danger-color); font-size:0.8rem; font-weight:bold;">❌ 處方箋憑證審核失敗，請重新上傳！</div>';
            } else {
                statusBadge = `<span class="badge badge-info">待領取</span>`;
                stepperHtml = generateStepperMarkup(2, '請攜帶健保卡正本到店');
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code style="background:#e2e8f0; padding:3px 6px; border-radius:4px;">${req.id}</code></td>
            <td><b>${pName}</b></td>
            <td>${rxImgBadge}</td>
            <td><strong>${req.item}</strong> (x${req.qty}盒)</td>
            <td style="color:var(--primary-color); font-weight:600;">${req.pickupTime}</td>
            <td>$ ${req.price}<br>${paidBadge}</td>
            <td>
                <div style="margin-bottom:5px;">${statusBadge}</div>
                ${stepperHtml}
            </td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteReservation('${req.id}')">
                    <i class="fa-solid fa-trash-can"></i> 刪除
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function viewOnlyPrescription(reqId) {
    let req = dbRequests.find(r => r.id === reqId);
    if (req && req.prescriptionImg) {
        document.getElementById('modalPrescriptionImg').src = req.prescriptionImg;
        document.getElementById('prescriptionViewModal').style.display = 'flex';
        // hide buttons to make it view-only
        document.querySelectorAll('#prescriptionViewModal .btn').forEach(btn => {
            if (btn.innerText.includes('關閉')) btn.style.display = 'inline-flex';
            else btn.style.display = 'none';
        });
    }
}

// Interactive stepper builder
function generateStepperMarkup(activeStep, note) {
    let steps = [
        { num: 1, label: '預約受理' },
        { num: 2, label: '處方審驗' },
        { num: 3, label: '專車調撥' },
        { num: 4, label: '送達領取' }
    ];
    let widthPercent = ((activeStep - 1) / 3) * 100;
    
    let stepsHtml = steps.map(s => {
        let isActive = s.num <= activeStep ? 'active' : '';
        return `
            <div class="logistics-step ${isActive}">
                <div class="logistics-dot">${s.num}</div>
                <div class="logistics-label">${s.label}</div>
            </div>
        `;
    }).join('');

    return `
        <div style="min-width: 260px; padding: 5px 0;">
            <div class="logistics-timeline" style="margin: 15px 0;">
                <div class="logistics-progress-bar" style="width: ${widthPercent}%;"></div>
                ${stepsHtml}
            </div>
            <div style="font-size:0.75rem; text-align:center; color:var(--secondary-color); font-weight:800;">
                📢 ${note}
            </div>
        </div>
    `;
}

// Render pharmacist reservation verification list
function renderReservationTable() {
    const tbody = document.querySelector('#reservationTable tbody'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    let myRes = dbRequests.filter(req => req.to === currentStation && req.from === '民眾');
    if (myRes.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">當前無居民慢箋預約。</td></tr>`; 
        return; 
    }
    
    myRes.forEach(req => {
        let verifyBtn = '';
        if (req.prescriptionImg) {
            if (req.prescriptionStatus === '待核實') {
                verifyBtn = `<button class="btn btn-info" style="padding:4px 8px; font-size:0.75rem;" onclick="openPrescriptionVerifyModal('${req.id}')"><i class="fa-solid fa-file-signature"></i> 審查處方相片</button>`;
            } else {
                verifyBtn = `<span class="badge badge-success" style="cursor:pointer;" onclick="openPrescriptionVerifyModal('${req.id}')">${req.prescriptionStatus} (點擊查看)</span>`;
            }
        } else {
            verifyBtn = `<span class="badge badge-success">免憑證</span>`;
        }

        let actionCell = '';
        if (req.status === '待核備領取' || req.status === '待領取') {
            actionCell = `
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-success" style="padding:5px 10px; font-size:0.78rem;" onclick="apiCompleteReservation('${req.id}')">發藥結案</button>
                    <button class="btn btn-danger" style="padding:5px 10px; font-size:0.78rem;" onclick="apiCancelReservation('${req.id}')">退回庫存</button>
                </div>
            `;
        } else {
            actionCell = `<span style="color:var(--text-muted); font-weight:700;"><i class="fa-solid fa-check-double"></i> ${req.status}</span>`;
        }

        let paidBadge = req.paidStatus.includes('已') 
            ? `<span class="badge badge-success">${req.paidStatus}</span>` 
            : `<span class="badge badge-danger">${req.paidStatus}</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600; color:var(--primary-light);">${req.pickupTime}</td>
            <td><b>王大明</b> <br><small style="color:var(--text-muted);">健保卡比對正常</small></td>
            <td>${verifyBtn}</td>
            <td><strong>${req.item}</strong> (x${req.qty} 盒)</td>
            <td>$ ${req.price}<br>${paidBadge}</td>
            <td>${actionCell}</td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteReservation('${req.id}')">
                    <i class="fa-solid fa-trash-can"></i> 刪除
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render pharmacist peer-to-peer transfer table
function renderInboxTable() {
    const tbodyInbox = document.querySelector('#inboxTable tbody'); 
    const tbodyOutbox = document.querySelector('#outboxTable tbody'); 
    if (!tbodyInbox || !tbodyOutbox) return; 
    
    tbodyInbox.innerHTML = '';
    tbodyOutbox.innerHTML = '';
    
    // Inbound: other pharmacies requesting help from currentStation (currentStation is the donor 'from')
    let myInbox = dbRequests.filter(req => req.from === currentStation && req.to !== '民眾');
    myInbox.forEach(req => {
        let btns = '';
        if (req.status === '待審核') {
            btns = `
                <button class="btn btn-success" style="padding:5px 10px;" onclick="apiApproveRequest('${req.id}')"><i class="fa-solid fa-check"></i> 准許出庫</button>
                <button class="btn btn-danger" style="padding:5px 10px;" onclick="apiRejectRequest('${req.id}')"><i class="fa-solid fa-xmark"></i> 拒絕</button>
            `;
        } else {
            btns = `<span style="font-weight:800;color:var(--secondary-color);">${req.status}</span>`;
        }
        
        let badgeStr = '';
        if (req.status === '待審核') badgeStr = `<span class="badge badge-warning"><i class="fa-solid fa-spinner fa-spin"></i> 待我審配</span>`;
        else if (req.status === '已核准出庫') badgeStr = `<span class="badge badge-info"><i class="fa-solid fa-box"></i> 已整備待收件</span>`;
        else if (req.status === '專車配送中') badgeStr = `<span class="badge badge-warning"><i class="fa-solid fa-truck"></i> 物流車送貨中</span>`;
        else if (req.status === '已送達簽收') badgeStr = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> 調撥完成</span>`;
        else badgeStr = `<span class="badge badge-danger">${req.status}</span>`;

        let toName = STATIONS_METADATA[req.to] ? STATIONS_METADATA[req.to].name : req.to;
        let fromName = STATIONS_METADATA[req.from] ? STATIONS_METADATA[req.from].name : req.from;

        const tr = document.createElement('tr'); 
        tr.innerHTML = `
            <td>${req.time || req.date}</td>
            <td><span class="badge badge-warning" style="background:#f1f5f9; color:var(--text-dark); border:1px solid var(--border-color);">${fromName} <i class="fa-solid fa-arrow-right-long" style="margin:0 4px; color:var(--text-muted);"></i> ${toName}</span></td>
            <td><strong>${req.item}</strong></td>
            <td>${req.qty} 盒</td>
            <td>${badgeStr}</td>
            <td>${btns}</td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteTransfer('${req.id}')">
                    <i class="fa-solid fa-trash-can"></i> 刪除
                </button>
            </td>
        `; 
        tbodyInbox.appendChild(tr);
    });
    
    // Outbound: currentStation requesting help from other pharmacies (currentStation is the receiver 'to')
    let myOutbox = dbRequests.filter(req => req.to === currentStation && req.from !== '民眾');
    myOutbox.forEach(req => {
        let badgeStr = '';
        if (req.status === '待審核') badgeStr = `<span class="badge badge-warning"><i class="fa-solid fa-spinner fa-spin"></i> 待對方審查</span>`;
        else if (req.status === '已核准出庫') badgeStr = `<span class="badge badge-info"><i class="fa-solid fa-box"></i> 準備出發</span>`;
        else if (req.status === '專車配送中') badgeStr = `<span class="badge badge-warning"><i class="fa-solid fa-truck fa-spin"></i> 調配專車配送中</span>`;
        else if (req.status === '已送達簽收') badgeStr = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> 已點收簽發</span>`;
        else badgeStr = `<span class="badge badge-danger">${req.status}</span>`;
        
        let fromName = STATIONS_METADATA[req.from] ? STATIONS_METADATA[req.from].name : req.from;

        const tr = document.createElement('tr'); 
        tr.innerHTML = `
            <td>${req.time || req.date}</td>
            <td><b>${fromName}</b></td>
            <td><strong>${req.item}</strong></td>
            <td>${req.qty} 盒</td>
            <td>${badgeStr}</td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteTransfer('${req.id}')">
                    <i class="fa-solid fa-trash-can"></i> 刪除
                </button>
            </td>
        `; 
        tbodyOutbox.appendChild(tr);
    });
}



// Render logistics vehicle shuttle list
function renderDriverTasks() {
    const container = document.getElementById('driverTaskList'); 
    if (!container) return; 
    container.innerHTML = '';
    
    let driverTasks = dbRequests.filter(req => req.status === '已核准出庫' || req.status === '專車配送中');
    if (driverTasks.length === 0) { 
        container.innerHTML = `
            <div style="text-align:center; padding: 40px; color:var(--text-muted);">
                <i class="fa-solid fa-mug-hot" style="font-size:3rem; margin-bottom:15px; color:var(--border-color);"></i><br>
                目前無跨區調撥任務，物流車待命休息中。
            </div>
        `; 
        return; 
    }
    
    driverTasks.forEach(req => {
        let card = document.createElement('div'); 
        card.style = "background: #fff; border: 1px solid var(--border-color); border-left: 6px solid var(--info-color); padding: 20px; border-radius: var(--radius-md); box-shadow: var(--card-shadow);";
        
        let fromMeta = STATIONS_METADATA[req.from];
        let toMeta = STATIONS_METADATA[req.to];
        let fromName = fromMeta ? fromMeta.name : req.from;
        let toName = toMeta ? toMeta.name : req.to;
        
        let targetTimeHtml = `
            <div style="font-size:0.85rem; color:var(--warning-color); margin-bottom:10px; font-weight:bold;">
                <i class="fa-solid fa-clock"></i> 期望送達時間：${req.targetTime || '依司機排程'}
            </div>
        `;

        let actionHtml = '';
        if (req.status === '已核准出庫') {
            actionHtml = `
                <div style="background:#f8fafc; padding:12px; border-radius:var(--radius-sm); margin-top:12px; border:1px solid var(--border-color);">
                    <label style="font-size:0.8rem; font-weight:bold; color:var(--primary-color); display:block; margin-bottom:8px;">設定調撥專車預計出發時間：</label>
                    <input type="datetime-local" id="dispatchTime_${req.id}" class="login-input" style="width:100%; padding:8px; font-size:0.9rem; margin-bottom:8px;">
                    <button class="btn btn-info" style="width:100%;" onclick="apiDriverDepart('${req.id}')"><i class="fa-solid fa-calendar-check"></i> 確定接單並出發配送</button>
                </div>
            `;
        } else if (req.status === '專車配送中') {
            actionHtml = `
                <button class="btn btn-success" style="width:100%; margin-top:12px;" onclick="apiDriverArrive('${req.id}')">
                    <i class="fa-solid fa-map-location-dot"></i> 確認抵達終點並點收簽核
                </button>
            `;
        }

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                <span style="color:var(--text-muted); font-weight:700; min-width:85px;">${req.time || req.date}</span>
                <span style="font-weight:800; color:var(--primary-color); text-align:right;">${req.item} <span style="color:var(--info-color);">x ${req.qty}</span></span>
            </div>
            ${targetTimeHtml}
            <div style="font-size:0.88rem; color:var(--text-muted); margin-bottom: 6px;"><i class="fa-solid fa-circle" style="color:var(--secondary-color); font-size:0.6rem;"></i> <b>起點 (出貨母艦)：</b> ${fromName}</div>
            <div style="font-size:0.88rem; color:var(--text-muted); margin-bottom: 6px;"><i class="fa-solid fa-location-dot" style="color:var(--danger-color); font-size:0.6rem;"></i> <b>終點 (前線藥局)：</b> ${toName}</div>
            ${actionHtml}
        `;
        container.appendChild(card);
    });
}

function apiDriverDepart(reqId) {
    let tInput = document.getElementById('dispatchTime_' + reqId);
    let departTime = tInput && tInput.value ? tInput.value.replace('T', ' ') : '立即出發';
    
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        let targetTo = r.to;
        let count = 0;
        
        // 統一將所有目的地相同、且等待出車的訂單一併發車
        dbRequests.forEach(req => {
            if (req.to === targetTo && req.status === '已核准出庫') {
                req.status = '專車配送中';
                req.dispatchTime = departTime;
                req.logisticsCondition = '常溫運輸中';
                count++;
            }
        });
        
        syncToDatabase();
        if (count > 1) {
            showToast(`已合併接單出車（共 ${count} 筆前往同地點）！出發時間：${departTime}`, 'success');
        } else {
            showToast(`已接單出車！出發時間：${departTime}`, 'success');
        }
        updateSystemState();
    }
}

function apiDriverArrive(reqId) {
    let r = dbRequests.find(req => req.id === reqId);
    if (r) {
        r.status = '已送達簽收';
        r.logisticsCondition = '已送達';
        r.arriveTime = getCurrentTime(); // 新增實際抵達時間

        
        // Add stock to target station and deduct from donor station
        let med = dbInventory.find(m => m.drugCode === r.drugCode);
        if (!med) med = dbInventory.find(m => m.drugChineseName === r.item); // Fallback

        if (med) {
            let toField = 'stock_' + r.to;
            let fromField = 'stock_' + r.from;
            
            let addQty = parseInt(r.qty, 10) || 0;
            let currentToStock = parseInt(med[toField] || 0, 10);
            let currentFromStock = parseInt(med[fromField] || 0, 10);

            med[toField] = currentToStock + addQty;
            med[fromField] = currentFromStock - addQty;
            if (med[fromField] < 0) med[fromField] = 0;
            
            // 點收完成後，清除該藥局的自動調撥註記，讓未來水位過低時能再次觸發
            let autoFlag = 'autoRequested_' + r.to;
            med[autoFlag] = false;
            
            syncToDatabase();
            console.log(`apiDriverArrive: Updated ${med.drugChineseName} stock. ${r.to}: ${currentToStock} -> ${med[toField]}. ${r.from}: ${currentFromStock} -> ${med[fromField]}`);
        } else {
            console.error("apiDriverArrive: 找不到藥品", r.item, r.drugCode);
        }

        // If this transfer was linked to a resident reservation, update its state as well!
        if (r.relatedReserveId) {
            let res = dbRequests.find(req => req.id === r.relatedReserveId);
            if (res) {
                res.status = '待領取'; // Transition resident status from '同業調撥中' to '待領取'
                res.prescriptionStatus = '已核實核發'; // Automatically set verified because the transfer completed
            }
        }

        syncToDatabase();
        showToast(`調撥藥品已點收，安全入庫！`, 'success');
        updateSystemState();
    }
}

// =========================================================================
// 🧭 DRIVER LIVE GPS NAVIGATION SIMULATOR
// =========================================================================

function startLiveNavigationLoop(task) {
    activeNavTask = task;
    navProgressPct = 0;

    const navCard = document.getElementById('driverLiveNavCard');
    if (navCard) navCard.style.display = 'block';

    if (liveNavInterval) clearInterval(liveNavInterval);

    // Weather linkage: advisory based on weather
    const hazardText = document.getElementById('hazardText');
    const hazardBox = document.getElementById('mountainHazardAlert');
    if (hazardText && hazardBox) {
        if (currentWeatherMode === 'rainy' || currentWeatherMode === 'typhoon') {
            hazardText.innerText = 'CWA 災防連動提醒：目前復興山區正在降雨/有警報。山區路段易有大霧與零星落石，台7線北橫公路已啟動限速 30km/h，請開啟霧燈並減速慢行，注意行車安全！';
            hazardBox.style.background = '#fef2f2';
            hazardBox.style.borderColor = '#fee2e2';
            hazardBox.style.color = '#b91c1c';
        } else {
            hazardText.innerText = '北橫公路天候良好、路面乾燥，視線清晰。限速 50km/h，請保持安全車距，行車平安。';
            hazardBox.style.background = '#f0fdf4';
            hazardBox.style.borderColor = '#bbf7d0';
            hazardBox.style.color = '#15803d';
        }
    }

    // Inject alert keyframes style if not exists
    if (!document.getElementById('nav-style-inject')) {
        const style = document.createElement('style');
        style.id = 'nav-style-inject';
        style.innerHTML = `
            @keyframes blinker {
                50% { opacity: 0.3; }
            }
        `;
        document.head.appendChild(style);
    }

    liveNavInterval = setInterval(updateLiveNavigation, 1000);

    updateLiveNavigation();

    if (isVoiceNavEnabled) {
        speakText("專車即時導航啟動。配送路段為由" + (STATIONS_METADATA[task.from] ? STATIONS_METADATA[task.from].name : task.from) + "前往" + (STATIONS_METADATA[task.to] ? STATIONS_METADATA[task.to].name : task.to));
    }
}

function stopLiveNavigationLoop() {
    if (liveNavInterval) clearInterval(liveNavInterval);
    liveNavInterval = null;
    activeNavTask = null;

    const navCard = document.getElementById('driverLiveNavCard');
    if (navCard) navCard.style.display = 'none';
}

function updateLiveNavigation() {
    if (!activeNavTask) {
        stopLiveNavigationLoop();
        return;
    }

    navProgressPct += 2.5; // Complete in 40 intervals (~40s)
    if (navProgressPct > 100) navProgressPct = 100;

    const startMeta = STATIONS_METADATA[activeNavTask.from] || { lat: 24.8809, lng: 121.2890, name: activeNavTask.from };
    const endMeta = STATIONS_METADATA[activeNavTask.to] || { lat: 24.8210, lng: 121.3526, name: activeNavTask.to };

    // Linear interpolation for simulated GPS coordinates
    const currentLat = startMeta.lat + (endMeta.lat - startMeta.lat) * (navProgressPct / 100);
    const currentLng = startMeta.lng + (endMeta.lng - startMeta.lng) * (navProgressPct / 100);

    const latEl = document.getElementById('liveLat');
    const lngEl = document.getElementById('liveLng');
    if (latEl && lngEl) {
        latEl.innerText = currentLat.toFixed(4);
        lngEl.innerText = currentLng.toFixed(4);
    }

    // Animate SVG path and truck positioning
    const pathElement = document.getElementById('highwayPath');
    const progressPathElement = document.getElementById('highwayProgressPath');
    const truckGroup = document.getElementById('mapTruckGroup');
    if (pathElement && progressPathElement && truckGroup) {
        const pathLength = pathElement.getTotalLength();
        const distance = (navProgressPct / 100) * pathLength;
        
        const point = pathElement.getPointAtLength(distance);
        truckGroup.setAttribute('transform', `translate(${point.x}, ${point.y})`);
        
        progressPathElement.setAttribute('stroke-dasharray', pathLength);
        progressPathElement.setAttribute('stroke-dashoffset', pathLength - distance);
    }

    // Navigation prompt logic
    let directionText = "";
    if (navProgressPct === 0) {
        directionText = `【已出發】專車已從 ${startMeta.name} 啟程出發！裝載 ${activeNavTask.item} (x${activeNavTask.qty}盒)。`;
    } else if (navProgressPct > 0 && navProgressPct <= 25) {
        directionText = "【行駛中】通過大溪三層路段，正駛入台7線北橫公路。前方進入彎道，山路駕駛請注意車速。";
    } else if (navProgressPct > 25 && navProgressPct <= 50) {
        directionText = "【行駛中】通過百吉隧道。目前正在進入山區路段，海拔逐漸上升。";
    } else if (navProgressPct > 50 && navProgressPct <= 75) {
        directionText = "【行駛中】車輛已越過復興橋，目前天候狀況良好。請遵循安全車速。";
    } else if (navProgressPct > 75 && navProgressPct < 100) {
        directionText = `【即將抵達】前方 500 公尺為目的地 ${endMeta.name}。請準備靠右停車進行點收簽到。`;
    } else {
        directionText = `【已抵達】已順利抵達終點 ${endMeta.name}！請立刻辦理藥品點收簽發，完成交付。`;
    }

    const navDirElement = document.getElementById('navDirectionText');
    if (navDirElement && navDirElement.innerText !== directionText) {
        navDirElement.innerText = directionText;
        if (isVoiceNavEnabled) {
            speakText(directionText);
        }
    }

    // Update Status Badge
    const statusBadge = document.getElementById('navLiveStatus');
    if (statusBadge) {
        if (navProgressPct < 100) {
            statusBadge.innerHTML = `<i class="fa-solid fa-truck fa-spin"></i> 配送中 (${navProgressPct.toFixed(0)}%)`;
            statusBadge.style.background = 'var(--warning-light)';
            statusBadge.style.color = 'var(--warning-color)';
        } else {
            statusBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> 已抵達目的地`;
            statusBadge.style.background = '#d1fae5';
            statusBadge.style.color = '#065f46';
        }
    }

    // Google Maps dir link update
    const gmapLink = document.getElementById('realGoogleMapLink');
    if (gmapLink) {
        gmapLink.href = `https://www.google.com/maps/dir/?api=1&origin=${startMeta.lat},${startMeta.lng}&destination=${endMeta.lat},${endMeta.lng}&travelmode=driving`;
    }

    if (navProgressPct >= 100) {
        clearInterval(liveNavInterval);
        liveNavInterval = null;
    }
}

function toggleVoiceNavigation() {
    isVoiceNavEnabled = !isVoiceNavEnabled;
    const icon = document.getElementById('voiceToggleIcon');
    const text = document.getElementById('voiceToggleText');
    if (icon && text) {
        if (isVoiceNavEnabled) {
            icon.className = 'fa-solid fa-volume-high';
            text.innerText = '語音已啟用';
            speakText("語音路段提醒已開啟，行車平安。");
        } else {
            icon.className = 'fa-solid fa-volume-mute';
            text.innerText = '啟用語音';
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        }
    }
}

function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const cleanText = text.replace(/【|】|⚠️|❌|📥|卸|點|🚚|🗺️|✨|☀️|🏪/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'zh-TW';
        window.speechSynthesis.speak(utterance);
    }
}

// Render admin transfer list
function renderAdminTransferTable() {
    const tbody = document.querySelector('#adminTransferTable tbody');
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    let transfers = dbRequests.filter(req => req.from !== '民眾');
    if (transfers.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">無物流調度紀錄。</td></tr>'; 
        return; 
    }
    
    transfers.forEach(req => {
        let fromName = STATIONS_METADATA[req.from] ? STATIONS_METADATA[req.from].name : req.from;
        let toName = STATIONS_METADATA[req.to] ? STATIONS_METADATA[req.to].name : req.to;
        
        let progressStr = `期望送達：${req.targetTime || '無指定'}`;
        if (req.dispatchTime && req.dispatchTime !== '安排中') {
            progressStr += `<br><span style="color:var(--info-color);">司機出車: ${req.dispatchTime}</span>`;
            
            // 計算預計抵達時間
            let dist = getDistance(req.from, req.to);
            let travelMins = Math.round(dist * 2);
            let dTime = new Date(req.dispatchTime.replace(' ', 'T'));
            if (isNaN(dTime)) dTime = new Date(); // 若為「立即出發」則以當下時間計算
            dTime.setMinutes(dTime.getMinutes() + travelMins);
            
            let arrMonth = String(dTime.getMonth() + 1).padStart(2, '0');
            let arrDate = String(dTime.getDate()).padStart(2, '0');
            let arrHour = String(dTime.getHours()).padStart(2, '0');
            let arrMin = String(dTime.getMinutes()).padStart(2, '0');
            
            if (req.status === '已送達簽收' && req.arriveTime) {
                progressStr += `<br><span style="color:var(--success-color); font-weight:800;"><i class="fa-solid fa-flag-checkered"></i> 實際抵達: ${req.arriveTime}</span>`;
            } else {
                progressStr += `<br><span style="color:var(--success-color); font-weight:800;"><i class="fa-solid fa-flag-checkered"></i> 預計抵達: ${arrMonth}/${arrDate} ${arrHour}:${arrMin}</span>`;
            }
        }
        
        let badgeClass = 'badge-warning';
        if (req.status === '專車配送中') badgeClass = 'badge-info';
        else if (req.status === '已送達簽收') badgeClass = 'badge-success';
        else if (req.status === '已退回') badgeClass = 'badge-danger';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${req.time || req.date}</td>
            <td><b>${fromName}</b> ➔ <b>${toName}</b></td>
            <td><strong>${req.item}</strong> (x${req.qty}盒)</td>
            <td>${progressStr}</td>
            <td><span class="badge ${badgeClass}">${req.status}</span></td>
            <td>
                <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteTransfer('${req.id}')">
                    <i class="fa-solid fa-trash-can"></i> 刪除
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPharmTransferTable() {
    const tbody = document.querySelector('#pharmTransferTable tbody');
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    // 藥局端只看到跟自己有關的調撥紀錄
    let transfers = dbRequests.filter(req => req.from !== '民眾' && (req.from === currentStation || req.to === currentStation));
    if (transfers.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">無物流調度紀錄。</td></tr>'; 
        return; 
    }
    
    transfers.forEach(req => {
        let fromName = STATIONS_METADATA[req.from] ? STATIONS_METADATA[req.from].name : req.from;
        let toName = STATIONS_METADATA[req.to] ? STATIONS_METADATA[req.to].name : req.to;
        
        let progressStr = `期望送達：${req.targetTime || '無指定'}`;
        if (req.dispatchTime && req.dispatchTime !== '安排中') {
            progressStr += `<br><span style="color:var(--info-color);">司機出車: ${req.dispatchTime}</span>`;
            
            // 計算預計抵達時間
            let dist = getDistance(req.from, req.to);
            let travelMins = Math.round(dist * 2);
            let dTime = new Date(req.dispatchTime.replace(' ', 'T'));
            if (isNaN(dTime)) dTime = new Date(); // 若為「立即出發」則以當下時間計算
            dTime.setMinutes(dTime.getMinutes() + travelMins);
            
            let arrMonth = String(dTime.getMonth() + 1).padStart(2, '0');
            let arrDate = String(dTime.getDate()).padStart(2, '0');
            let arrHour = String(dTime.getHours()).padStart(2, '0');
            let arrMin = String(dTime.getMinutes()).padStart(2, '0');
            
            if (req.status === '已送達簽收' && req.arriveTime) {
                progressStr += `<br><span style="color:var(--success-color); font-weight:800;"><i class="fa-solid fa-flag-checkered"></i> 實際抵達: ${req.arriveTime}</span>`;
            } else {
                progressStr += `<br><span style="color:var(--success-color); font-weight:800;"><i class="fa-solid fa-flag-checkered"></i> 預計抵達: ${arrMonth}/${arrDate} ${arrHour}:${arrMin}</span>`;
            }
        }
        
        let badgeClass = 'badge-warning';
        if (req.status === '專車配送中') badgeClass = 'badge-info';
        else if (req.status === '已送達簽收') badgeClass = 'badge-success';
        else if (req.status === '已退回') badgeClass = 'badge-danger';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${req.time || req.date}</td>
            <td><b>${fromName}</b> ➔ <b>${toName}</b></td>
            <td><strong>${req.item}</strong> (x${req.qty}盒)</td>
            <td>${progressStr}</td>
            <td><span class="badge ${badgeClass}">${req.status}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function showFlowLog(drugChineseName) {
    const modal = document.getElementById('logModal'); 
    const logList = document.getElementById('logList'); 
    
    document.getElementById('logItemName').innerText = `監控藥品：${drugChineseName}`; 
    logList.innerHTML = '';
    
    let relatedReqs = dbRequests.filter(r => r.item === drugChineseName && r.status === '已送達簽收');
    if (relatedReqs.length === 0) { 
        logList.innerHTML = '<li style="color:var(--text-muted); text-align:center; padding:15px;">全區尚未有該品項之配送流轉紀錄。</li>'; 
    } else {
        relatedReqs.forEach(req => {
            let li = document.createElement('li'); 
            li.style = "padding:12px; border-bottom:1px solid var(--border-color); font-size:0.9rem; display:flex; align-items:center; gap:10px;";
            li.innerHTML = `
                <span style="color:var(--text-muted); font-weight:700; min-width:85px;">${req.time}</span>
                <span class="badge badge-success">物流送達</span> 
                <span>由 <b>${STATIONS_METADATA[req.from].name}</b> ➔ 調配至 <b>${STATIONS_METADATA[req.to].name}</b></span>
                <span style="margin-left:auto; font-weight:bold; color:var(--danger-color);">${req.qty} 盒</span>
            `; 
            logList.appendChild(li);
        });
    }
    modal.style.display = 'flex';
}

// Chart.js renderings for seasonal disease patterns (疾管署健保門急診就診人次開放資料)
// 資料流：fetch_cdc_data.py → SQLite disease_monthly → GET /api/disease-seasonal → 本圖
let seasonalChartInstance = null;
const seasonalCache = {};          // 依縣市快取 API 結果，避免每次重繪都重新查詢
let seasonalControlsBound = false;

const SEASONAL_MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const SEASONAL_COLORS = {
    flu:      { line: '#ef4444', fill: 'rgba(239, 68, 68, 0.05)' },   // 流感
    ev:       { line: '#a855f7', fill: 'rgba(168, 85, 247, 0.05)' },  // 腸病毒
    diarrhea: { line: '#fbbf24', fill: 'rgba(251, 191, 36, 0.05)' }   // 腹瀉
};
// 尚未執行 fetch_cdc_data.py 時的示意資料（依各疾病典型季節趨勢）
const SEASONAL_FALLBACK = [
    { label: '流感高發區 (克流感膠囊)', data: [14000, 11000, 7500, 3000, 1200, 900, 800, 900, 1500, 4200, 8000, 13000], code: 'flu' },
    { label: '腸病毒高峰 (退燒糖漿)', data: [500, 400, 900, 2800, 7500, 11000, 8500, 5000, 7800, 2500, 1100, 600], code: 'ev' },
    { label: '腹瀉分佈 (樂必寧膠囊)', data: [9000, 8500, 7000, 6500, 6800, 7200, 7500, 7300, 6800, 6500, 7000, 8800], code: 'diarrhea' }
];

async function loadSeasonalData(county) {
    const key = county || '__all__';
    if (seasonalCache[key]) return seasonalCache[key];
    try {
        const res = await fetch(`/api/disease-seasonal?county=${encodeURIComponent(county)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.available) seasonalCache[key] = data;
        return data;
    } catch (e) {
        console.warn('季節性疾病資料載入失敗，改用示意資料：', e);
        return { available: false, reason: 'offline' };
    }
}

function bindSeasonalControls() {
    if (seasonalControlsBound) return;
    const countySel = document.getElementById('seasonalCounty');
    const metricSel = document.getElementById('seasonalMetric');
    if (!countySel || !metricSel) return;
    countySel.addEventListener('change', renderAdminCharts);
    metricSel.addEventListener('change', renderAdminCharts);
    seasonalControlsBound = true;
}

function fillCountyOptions(counties) {
    const sel = document.getElementById('seasonalCounty');
    if (!sel || sel.dataset.filled === '1') return;
    const current = sel.value;
    // 偏鄉藥局位於桃園市，若資料中有就排在最前面
    const sorted = counties.includes('桃園市') ? ['桃園市', ...counties.filter(c => c !== '桃園市')] : counties;
    sorted.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
    });
    sel.value = current;
    sel.dataset.filled = '1';
}

function drawSeasonalChart(datasets, yTitle) {
    const ctx = document.getElementById('seasonalChart');
    if (!ctx) return;
    if (seasonalChartInstance) seasonalChartInstance.destroy();
    seasonalChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: SEASONAL_MONTHS, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { font: { family: 'Inter', weight: '600' } } },
                tooltip: {
                    callbacks: {
                        label: c => {
                            const extra = c.dataset.avg ? `（平均 ${c.dataset.avg[c.dataIndex]} 人次）` : '';
                            return `${c.dataset.label}: ${c.formattedValue}${yTitle.includes('%') ? '%' : ''}${extra}`;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, title: { display: true, text: yTitle } },
                x: { grid: { display: false } }
            }
        }
    });
}

async function renderAdminCharts() {
    if (!document.getElementById('seasonalChart')) return;
    bindSeasonalControls();
    const county = document.getElementById('seasonalCounty')?.value || '';
    const metric = document.getElementById('seasonalMetric')?.value || 'share';
    const sourceEl = document.getElementById('seasonalSource');

    const data = await loadSeasonalData(county);

    if (!data.available || !data.diseases.length) {
        drawSeasonalChart(SEASONAL_FALLBACK.map(d => ({
            label: d.label, data: d.data, borderColor: SEASONAL_COLORS[d.code].line,
            backgroundColor: SEASONAL_COLORS[d.code].fill, fill: d.code !== 'diarrhea', tension: 0.3
        })), '就診人次（示意）');
        if (sourceEl) sourceEl.textContent = '⚠ 示意資料：尚未匯入疾管署資料，請先執行 python fetch_cdc_data.py';
        return;
    }

    fillCountyOptions(data.counties);
    drawSeasonalChart(data.diseases.map(d => {
        const color = SEASONAL_COLORS[d.code] || { line: '#64748b', fill: 'transparent' };
        return {
            label: `${d.name} (${d.drug})`,
            data: metric === 'share' ? d.share : d.monthlyAvg,
            avg: metric === 'share' ? d.monthlyAvg : null,
            borderColor: color.line, backgroundColor: color.fill,
            fill: d.code !== 'diarrhea', tension: 0.3
        };
    }), metric === 'share' ? '占全年就診人次比例 (%)' : '每月平均就診人次');

    if (sourceEl) {
        const peaks = data.diseases.filter(d => d.peakMonth).map(d => `${d.name} ${d.peakMonth} 月`).join('、');
        sourceEl.textContent =
            `資料來源：衛福部疾管署開放資料（健保門急診就診人次）｜${data.county}｜${data.yearFrom}–${data.yearTo} 年（${data.yearCount} 年平均）` +
            (peaks ? `｜高峰月份：${peaks}` : '');
    }
}

// Initial setup
window.onload = function() {
    setupDragAndDrop();
    fetchSystemData();
};
// =========================================================================
// API SYNC LOGIC (結合前端 LocalStorage 狀態持久化與後端同步)
// =========================================================================
async function syncToDatabase() {
    // 1. 實作企劃書要求：前端 localStorage 用於跨頁面/跨角色操作狀態持久化
    localStorage.setItem('SmartPharma_Inventory', JSON.stringify(dbInventory));
    localStorage.setItem('SmartPharma_Requests', JSON.stringify(dbRequests));

    // 2. 同步至後端資料庫 (保留跨設備即時連線能力)
    try {
        await fetch('/api/syncInventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbInventory)
        });
        await fetch('/api/syncRequests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbRequests)
        });
    } catch (error) {
        console.error("後端同步失敗，但資料已安全保留於 LocalStorage:", error);
    }
}
