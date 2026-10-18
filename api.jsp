<%@ page language="java" contentType="application/json; charset=UTF-8" pageEncoding="UTF-8"%>
<%@ page import="java.util.*" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%
    // 🌟 強制啟用 v13 最新記憶體
    List<Map<String, Object>> inventory = (List<Map<String, Object>>) application.getAttribute("db_inventory_v13");
    List<Map<String, Object>> requests = (List<Map<String, Object>>) application.getAttribute("db_requests_v13");

    if (inventory == null) {
        inventory = new ArrayList<>();
        inventory.add(createMed("SN101", "普拿疼止痛錠 (Panadol)", 50, 45, 30, 150, false)); 
        inventory.add(createMed("SN102", "降血糖藥 (Metformin)", 85, 60, 40, 250, true)); 
        inventory.add(createMed("SN103", "伯基腸溶膠囊 (Aspirin)", 40, 35, 25, 300, true));
        inventory.add(createMed("SN104", "脈優錠 (高血壓用藥)", 65, 55, 35, 450, true));
        inventory.add(createMed("SN105", "冠脂妥 (降血脂藥)", 45, 50, 20, 520, true));
        inventory.add(createMed("SN106", "康肯 (心律不整用藥)", 30, 40, 15, 380, true));
        inventory.add(createMed("SN107", "泰克胃通 (胃潰瘍用藥)", 55, 60, 25, 600, true));
        inventory.add(createMed("SN108", "保栓通 (抗凝血用藥)", 40, 45, 30, 1200, true));
        inventory.add(createMed("SN109", "綜合感冒糖漿", 35, 40, 50, 120, false));
        inventory.add(createMed("SN110", "抗組織胺 (過敏/尋麻疹)", 60, 50, 45, 180, false));
        application.setAttribute("db_inventory_v13", inventory);
    }

    if (requests == null) {
        requests = new ArrayList<>();
        application.setAttribute("db_requests_v13", requests);
    }

    request.setCharacterEncoding("UTF-8");
    String action = request.getParameter("action");
    String jsonResponse = "{\"status\":\"error\"}";
    SimpleDateFormat sdf = new SimpleDateFormat("MM/dd HH:mm");
    String currentTimeStr = sdf.format(new Date());

    try {
        if ("getInventory".equals(action)) { jsonResponse = buildInventoryJson(inventory); } 
        else if ("getRequests".equals(action)) { jsonResponse = buildRequestsJson(requests); } 
        else if ("buyerReserve".equals(action)) {
            String itemName = request.getParameter("item"); String station = request.getParameter("station");
            String payment = request.getParameter("payment"); String pickupTime = request.getParameter("pickupTime"); 
            String paidStatus = request.getParameter("paidStatus"); 
            
            // 🌟 讀取數量與總價
            String qtyStr = request.getParameter("qty");
            int reserveQty = (qtyStr != null && !qtyStr.isEmpty()) ? Integer.parseInt(qtyStr) : 1;
            String priceStr = request.getParameter("price");
            int totalPrice = (priceStr != null && !priceStr.isEmpty()) ? Integer.parseInt(priceStr) : 150;
            boolean success = false;

            for (Map<String, Object> med : inventory) {
                if (med.get("name").equals(itemName)) {
                    // 🌟 判斷庫存是否大於等於使用者選擇的數量，並精準扣除
                    if ("A".equals(station) && (int)med.get("stockA") >= reserveQty) { med.put("stockA", (int)med.get("stockA") - reserveQty); success = true; }
                    else if ("B".equals(station) && (int)med.get("stockB") >= reserveQty) { med.put("stockB", (int)med.get("stockB") - reserveQty); success = true; }
                    else if ("C".equals(station) && (int)med.get("stockC") >= reserveQty) { med.put("stockC", (int)med.get("stockC") - reserveQty); success = true; }
                    break;
                }
            }
            if(success) {
                Map<String, Object> resReq = new HashMap<>();
                resReq.put("id", "RES-" + (int)(Math.random() * 9000 + 1000)); resReq.put("from", "民眾"); resReq.put("to", station);
                resReq.put("item", itemName); resReq.put("status", "待領取"); resReq.put("time", currentTimeStr);
                resReq.put("payment", payment); resReq.put("pickupTime", pickupTime); resReq.put("paidStatus", paidStatus); 
                resReq.put("qty", reserveQty); // 🌟 寫入購買者指定的數量
                resReq.put("price", totalPrice); // 🌟 寫入系統算好的總金額
                requests.add(resReq); jsonResponse = "{\"status\":\"success\"}";
            } else {
                jsonResponse = "{\"status\":\"error\", \"message\":\"庫存不足，無法保留您指定的數量！\"}";
            }
        } 
        else if ("completeReservation".equals(action)) {
            String reqId = request.getParameter("reqId");
            for (Map<String, Object> r : requests) { if (r.get("id").equals(reqId)) { r.put("status", "已領藥結案"); r.put("paidStatus", "已支付"); jsonResponse = "{\"status\":\"success\"}"; break; } }
        }
        else if ("addRequest".equals(action)) {
            String from = request.getParameter("from"); String to = request.getParameter("to"); String item = request.getParameter("item");
            int qty = Integer.parseInt(request.getParameter("qty") != null ? request.getParameter("qty") : "1");
            String targetTime = request.getParameter("targetTime");
            
            Map<String, Object> req = new HashMap<>();
            req.put("id", "REQ-" + (int)(Math.random() * 9000 + 1000));
            req.put("from", from); req.put("to", to); req.put("item", item); req.put("qty", qty);
            req.put("status", "待審核"); req.put("time", currentTimeStr);
            if(targetTime != null && !targetTime.isEmpty()) req.put("targetTime", targetTime);
            
            requests.add(req); jsonResponse = "{\"status\":\"success\"}";
        }
        else if ("approveRequest".equals(action)) {
            String reqId = request.getParameter("reqId");
            for (Map<String, Object> r : requests) {
                if (r.get("id").equals(reqId)) {
                    r.put("status", "已核准並出庫");
                    String item = (String) r.get("item"); int qty = (Integer) r.get("qty");
                    String from = (String) r.get("from"); String to = (String) r.get("to");
                    for (Map<String, Object> med : inventory) {
                        if (med.get("name").equals(item)) {
                            if("A".equals(to)) med.put("stockA", (int)med.get("stockA") - qty);
                            if("B".equals(to)) med.put("stockB", (int)med.get("stockB") - qty);
                            if("C".equals(to)) med.put("stockC", (int)med.get("stockC") - qty);
                            if("A".equals(from)) med.put("stockA", (int)med.get("stockA") + qty);
                            if("B".equals(from)) med.put("stockB", (int)med.get("stockB") + qty);
                            if("C".equals(from)) med.put("stockC", (int)med.get("stockC") + qty);
                            break;
                        }
                    }
                    jsonResponse = "{\"status\":\"success\"}"; break;
                }
            }
        }
        else if ("rejectRequest".equals(action)) {
            String reqId = request.getParameter("reqId");
            for (Map<String, Object> r : requests) { if (r.get("id").equals(reqId)) { r.put("status", "已拒絕"); jsonResponse = "{\"status\":\"success\"}"; break; } }
        }
        else if ("updateReqStatus".equals(action)) {
            String reqId = request.getParameter("reqId"); String newStatus = request.getParameter("newStatus");
            for (Map<String, Object> r : requests) { if (r.get("id").equals(reqId)) { r.put("status", newStatus); jsonResponse = "{\"status\":\"success\"}"; break; } }
        }
        else if ("scheduleDeparture".equals(action)) {
            String reqId = request.getParameter("reqId"); String dTime = request.getParameter("dispatchTime");
            for (Map<String, Object> r : requests) { if (r.get("id").equals(reqId)) { r.put("status", "配送中"); r.put("dispatchTime", dTime); jsonResponse = "{\"status\":\"success\"}"; break; } }
        }
    } catch(Exception e) {}
    out.print(jsonResponse); out.flush();
%>

<%! 
    private Map<String, Object> createMed(String id, String n, int a, int b, int c, int p, boolean rx) {
        Map<String, Object> m = new HashMap<>(); m.put("id", id); m.put("name", n); m.put("stockA", a); m.put("stockB", b); m.put("stockC", c); m.put("price", p); m.put("rxOnly", rx); return m;
    }
    private String buildInventoryJson(List<Map<String, Object>> list) {
        StringBuilder sb = new StringBuilder("[");
        for (int i=0; i<list.size(); i++) {
            Map<String, Object> m = list.get(i);
            sb.append(String.format("{\"id\":\"%s\",\"name\":\"%s\",\"stockA\":%d,\"stockB\":%d,\"stockC\":%d,\"price\":%d,\"rxOnly\":%b}", m.get("id"), m.get("name"), m.get("stockA"), m.get("stockB"), m.get("stockC"), m.get("price"), m.get("rxOnly")));
            if(i < list.size()-1) sb.append(",");
        } return sb.append("]").toString();
    }
    private String buildRequestsJson(List<Map<String, Object>> list) {
        StringBuilder sb = new StringBuilder("[");
        for (int i=0; i<list.size(); i++) {
            Map<String, Object> m = list.get(i);
            String pay = m.get("payment") != null ? (String)m.get("payment") : ""; 
            String pTime = m.get("pickupTime") != null ? (String)m.get("pickupTime") : ""; 
            String pStat = m.get("paidStatus") != null ? (String)m.get("paidStatus") : "未支付"; 
            int price = m.get("price") != null ? (Integer)m.get("price") : 0;
            String tTime = m.get("targetTime") != null ? (String)m.get("targetTime") : "";
            String dTime = m.get("dispatchTime") != null ? (String)m.get("dispatchTime") : "";

            sb.append(String.format("{\"id\":\"%s\",\"from\":\"%s\",\"to\":\"%s\",\"item\":\"%s\",\"qty\":%d,\"status\":\"%s\",\"time\":\"%s\",\"payment\":\"%s\",\"pickupTime\":\"%s\",\"paidStatus\":\"%s\",\"price\":%d,\"targetTime\":\"%s\",\"dispatchTime\":\"%s\"}", 
            m.get("id"), m.get("from"), m.get("to"), m.get("item"), m.get("qty"), m.get("status"), m.get("time"), pay, pTime, pStat, price, tTime, dTime));
            if(i < list.size()-1) sb.append(",");
        } return sb.append("]").toString();
    }
%>