/* 光下绿洲 · 界面与交互 */
(function () {
  const D = window.DATA;
  const E = window.Engine;
  const C = window.Charts;
  const SITE = D.SITE;
  const $ = (id) => document.getElementById(id);

  const state = {
    weather: { ...D.WEATHER },
    tab: "overview",
    layer: "ndvi",
    analysis: null,
    prescription: null,
    selectedItem: null,
    executing: false,
    autoDispatch: false,
    clockMin: 8 * 60 + 30,
    logs: [
      { time: "08:20", type: "数据入库", msg: "气象站与 38 个墒情节点数据入库，离线 4 个" },
      { time: "08:22", type: "边缘同步", msg: "边缘盒子同步昨日处方执行回采，断网缓存补传 1,240 条" },
      { time: "09:05", type: "巡检出图", msg: "6 月 14 日架次正射与指数图处理完成，识别异常斑块 7 处" },
      { time: "09:18", type: "胁迫预警", msg: "板间·中段、板缘·北带触及重度缺水阈值，已推送值班室" }
    ]
  };

  const nf = (n, d) => Number(n).toLocaleString("zh-CN", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const wan = (n, d) => (Number(n) / 10000).toFixed(d === undefined ? 1 : d);
  const pct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + "%";
  const microName = (m) => ({ under: "板下", between: "板间", edge: "板缘" }[m]);
  const stressColor = (lv) => ["#5fd48a", "#e0c15a", "#e39a34", "#ef6b63"][lv];

  /* ---------------- 通用刷新 ---------------- */
  function refresh() {
    state.analysis = E.analyzeAll(SITE, state.weather, D.CROP_KC);
    renderKpis();
    renderForecastChart();
    renderOverviewPartitions();
    renderDemand();
    renderQuotaBanner();
    renderHealthStats();
  }

  /* ---------------- 总览 ---------------- */
  function renderKpis() {
    const t = E.ledgerTotals(D.LEDGER);
    const demand = E.totalDemand(state.analysis);
    const q = E.availableQuota(SITE);
    const cards = [
      { label: "灌溉节水率", value: pct(t.savingRate), note: "本生长季累计 · 同季对照区", accent: "#5fd48a" },
      { label: "今日蒸散需水", value: wan(demand, 1), unit: "万 m³", note: "8 个分区 · 含覆盖度折算", accent: "#45c8d6" },
      { label: "日均可分配配额", value: wan(q.daily, 2), unit: "万 m³", note: `本月剩余 ${wan(q.remain)} 万 · ${SITE.quota.daysLeft} 天`, accent: "#f2b04b" },
      { label: "处方采纳率", value: "82.4", unit: "%", note: "下发 68 条 / 执行 56 条", accent: "#5fd48a" },
      { label: "7 日墒情预测误差", value: "0.014", unit: "m³/m³", note: "留出期回测 RMSE · 目标 ≤0.020", accent: "#45c8d6" },
      { label: "胁迫识别准确率", value: "88.2", unit: "%", note: "地面样方 46 处 · 目标 ≥85%", accent: "#f2b04b" }
    ];
    $("kpiRow").innerHTML = cards.map((c) => `
      <div class="kpi" style="--kpi-accent:${c.accent}">
        <p>${c.label}</p>
        <strong>${c.value}${c.unit ? `<small>${c.unit}</small>` : ""}</strong>
        <em>${c.note}</em>
      </div>`).join("");
  }

  function renderForecastChart() {
    const todayDemand = E.totalDemand(state.analysis);
    const fc = E.dailyDemandForecast(SITE, state.weather, D.CROP_KC);
    const q = availableDaily();
    const labels = ["今日", ...fc.map((f) => f.label)];
    const data = [todayDemand, ...fc.map((f) => f.m3)];
    C.lineChart($("forecastChart"), {
      labels,
      series: [
        { name: "蒸散需水", color: "#45c8d6", data },
        { name: "日均配额", color: "#f2b04b", data: labels.map(() => q), area: false, dashed: true, width: 1.6 }
      ],
      yUnit: " m³"
    });
    const gap = todayDemand - q;
    $("forecastNote").innerHTML = gap > 0
      ? `今日需水较日均配额多 <b>${nf(gap)} m³</b>，系统按胁迫程度排序，优先保障重度缺水分区，其余顺延至下一个灌溉窗口。`
      : `今日需水低于日均配额 <b>${nf(-gap)} m³</b>，配额可覆盖全部 8 个分区，余量结转至下一旬。`;
  }

  function renderOverviewPartitions() {
    const rows = state.analysis.slice().sort((a, b) => a.reserve - b.reserve);
    $("overviewPartitions").innerHTML = rows.map((p) => {
      const col = stressColor(p.stress.level);
      return `<div class="part-row" data-part="${p.id}" title="${p.name} · ${p.crop} · ${p.soil}">
        <span class="part-name"><i style="background:${col}"></i>${p.name.replace("·", " ")}</span>
        <span class="moist-bar"><span style="width:${Math.round(p.ratio * 100)}%;background:${col}"></span></span>
        <b>${(p.theta * 100).toFixed(1)}%</b>
        <small style="color:${col}">${p.reserve >= 8 ? "8+ 天" : p.reserve + " 天"}</small>
      </div>`;
    }).join("");
  }

  function renderAlerts() {
    const severe = state.analysis.filter((p) => p.stress.level === 3).sort((a, b) => a.reserve - b.reserve);
    const demand = E.totalDemand(state.analysis);
    const q = availableDaily();
    const items = [];
    severe.forEach((p) => items.push({
      level: "high", ico: "!",
      title: `${p.name}触及重度缺水阈值，剩余支撑约 ${p.reserve} 天`,
      desc: `含水率 ${(p.theta * 100).toFixed(1)}%（凋萎点 ${(p.wp * 100).toFixed(1)}%）· 今日需水 ${nf(p.m3)} m³`
    }));
    items.push({
      level: "mid", ico: "∿",
      title: "SN-07 墒情节点离线 18 小时，板间·中段仅剩 2 个有效点位",
      desc: "初判风沙掩埋，已派单巡检；离线率 9.5%（4 / 42）"
    });
    if (demand > q) items.push({
      level: "mid", ico: "◑",
      title: `今日配额缺口约 ${nf(demand - q)} m³`,
      desc: "处方将按优先级分配，轻度胁迫分区顺延，不平均摊薄"
    });
    items.push({
      level: "low", ico: "◎",
      title: "巡检识别死亡斑块 SP-05（板下·中区 28 亩），建议补植",
      desc: "NDVI 0.11 · 已完成出图并关联到 V-02 分区"
    });
    $("alertList").innerHTML = items.slice(0, 4).map((a) => `
      <div class="alert-item ${a.level}">
        <span class="ico">${a.ico}</span>
        <div><p>${a.title}</p><em>${a.desc}</em></div>
      </div>`).join("");
  }

  function renderInspect() {
    $("inspectSummary").innerHTML = `
      <div><p>飞行架次</p><b>${D.INSPECTION.sorties}</b></div>
      <div><p>覆盖面积</p><b>${nf(D.INSPECTION.areaMu)} 亩</b></div>
      <div><p>飞行时长</p><b>${D.INSPECTION.flight}</b></div>
      <div><p>出图时长</p><b>${D.INSPECTION.render}</b></div>
      <div><p>原始影像</p><b>${nf(D.INSPECTION.images)} 张</b></div>
      <div><p>地面分辨率</p><b>${D.INSPECTION.resolution}</b></div>`;
    $("healthFlightMeta").textContent = `${D.INSPECTION.date} 架次 · ${D.INSPECTION.layers}`;
  }

  function renderEdgeSummary() {
    const b = D.EDGE_BOX;
    $("edgeSummary").innerHTML = `
      <div class="edge-line"><span>断网连续运行</span><b>${b.offlineRun.replace("断网连续运行 ", "")}</b></div>
      <div class="edge-line"><span>本地缓存</span><b>${b.cache.replace("缓存 ", "")}</b></div>
      <div class="edge-line"><span>推理时延</span><b>${b.latency}</b></div>
      <div class="edge-line"><span>最近同步</span><b>${b.lastSync}</b></div>
      <div class="edge-line"><span>运行时长</span><b>${b.uptime.replace("运行 ", "")}</b></div>`;
  }

  /* ---------------- 需水账 ---------------- */
  function renderDemand() {
    const E0 = E.et0(SITE, state.weather, SITE.doy);
    $("et0Value").textContent = E0.value.toFixed(2);
    $("et0Terms").innerHTML = [
      ["参考蒸发需求", `${E0.value.toFixed(2)} mm`],
      ["净辐射 Rn", `${E0.Rn.toFixed(2)} MJ`],
      ["水汽压差 VPD", `${E0.vpd.toFixed(2)} kPa`],
      ["饱和水汽压 es", `${E0.es.toFixed(2)} kPa`],
      ["干湿表常数 γ", `${E0.gamma.toFixed(3)}`],
      ["天顶辐射 Ra", `${E0.Ra.toFixed(1)} MJ`],
      ["Rs / Rso", E0.RsRso.toFixed(2)],
      ["气压 P", `${E0.P.toFixed(1)} kPa`]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

    const total = E.totalDemand(state.analysis);
    $("demandTotalBadge").textContent = `全域 ${nf(total)} m³ / 日`;
    $("demandTable").innerHTML = `
      <thead><tr>
        <th>分区</th><th>微生境</th><th class="num">面积(亩)</th><th class="num">Kc 有效</th>
        <th class="num">日蒸散(mm)</th><th class="num">含水率</th><th class="num">亏缺(mm)</th>
        <th class="num">可撑</th><th>状态</th>
      </tr></thead>
      <tbody>${state.analysis.map((p) => `
        <tr>
          <td class="zone">${p.name}</td>
          <td><span class="tag ${p.micro}">${microName(p.micro)} · ${p.crop}</span></td>
          <td class="num">${nf(p.area)}</td>
          <td class="num">${p.kc.total.toFixed(2)}</td>
          <td class="num">${p.mm.toFixed(2)}</td>
          <td class="num">${(p.theta * 100).toFixed(1)}%</td>
          <td class="num">${p.deficitMm.toFixed(1)}</td>
          <td class="num" style="color:${stressColor(p.stress.level)}">${p.reserve >= 8 ? "8+" : p.reserve} 天</td>
          <td><span class="status-dot"><i style="background:${stressColor(p.stress.level)}"></i>${p.stress.label}</span></td>
        </tr>`).join("")}
      </tbody>`;
    renderMoistureChart();
    renderBalanceTable();
  }

  function selectedPartition() {
    const id = $("forecastPartition").value || "P5";
    return state.analysis.find((p) => p.id === id) || state.analysis[0];
  }

  function renderMoistureChart() {
    const sel = $("forecastPartition");
    if (sel.options.length === 0) {
      sel.innerHTML = state.analysis.map((p) => `<option value="${p.id}">${p.name} · ${p.crop}</option>`).join("");
      sel.value = "P5";
    }
    const p = selectedPartition();
    const ser = E.moistureSeries(p, SITE, state.weather, D.CROP_KC);
    const labels = ["今日", ...D.FORECAST.map((f) => f.label)];
    C.lineChart($("moistureChart"), {
      labels,
      series: [{ name: "预测含水率", color: "#45c8d6", data: ser.series.map((v) => v * 100) }],
      yUnit: "%",
      yMax: Math.max(24, p.fc * 100 + 4),
      yMin: 0,
      thresholds: [
        { value: p.fc * 100, color: "#5fd48a", label: `田持 ${(p.fc * 100).toFixed(0)}%` },
        { value: ser.stressTheta * 100, color: "#ef6b63", label: `胁迫线 ${(ser.stressTheta * 100).toFixed(1)}%` }
      ]
    });
    $("moistureNote").innerHTML = `${p.name}（${p.soil}，根层 ${p.rootDepth.toFixed(2)} m）：今日蒸散 ${ser.et.toFixed(2)} mm，` +
      `若不灌溉，约 <b>${ser.days >= 8 ? "8 天以上" : ser.days + " 天"}</b>触及胁迫线；` +
      `预测期有效降水累计 ${D.FORECAST.reduce((s, f) => s + f.rain, 0).toFixed(1)} mm。`;
  }

  function renderBalanceTable() {
    const p = selectedPartition();
    const rows = [];
    let theta = p.theta;
    rows.push({ label: "今日", rain: 0, et: p.mm, theta });
    D.FORECAST.forEach((f, i) => {
      const E0 = E.et0(SITE, f, SITE.doy + i + 1);
      const et = E0.value * p.kc.total;
      theta = theta + (f.rain * 0.75) / (p.rootDepth * 1000) - et / (p.rootDepth * 1000);
      theta = Math.max(0, theta);
      rows.push({ label: f.label, rain: f.rain, et, theta });
    });
    $("balanceTable").innerHTML = `
      <thead><tr><th>日期</th><th class="num">降水(mm)</th><th class="num">蒸散(mm)</th><th class="num">末含水率</th><th>状态</th></tr></thead>
      <tbody>${rows.map((r) => {
        const ratio = (r.theta - p.wp) / (p.fc - p.wp);
        const st = E.stressLevelFromRatio(ratio);
        return `<tr><td>${r.label}</td><td class="num">${r.rain.toFixed(1)}</td><td class="num">${r.et.toFixed(2)}</td>
          <td class="num">${(r.theta * 100).toFixed(1)}%</td>
          <td><span class="status-dot"><i style="background:${stressColor(st.level)}"></i>${st.label}</span></td></tr>`;
      }).join("")}</tbody>`;
    $("shadeVal").textContent = Math.round(SITE.panels.shadeRatio * 100) + "%";
  }

  /* ---------------- 健康地图 ---------------- */
  const healthCells = [];

  function buildGrid() {
    if (healthCells.length) return;
    let seed = 20260615;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    D.MAP_LAYOUT.forEach((b) => {
      const p = D.PARTITIONS.find((x) => x.id === b.id);
      const cols = 9, rows = 6;
      const pad = 7;
      const cw = (b.w - pad * 2) / cols;
      const ch = (b.h - pad * 2 - 18) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = b.x + pad + c * cw;
          const y = b.y + pad + 18 + r * ch;
          const ratio = (p.theta - p.wp) / (p.fc - p.wp);
          let ndvi = 0.30 + p.cover * 0.55 + (rnd() - 0.5) * 0.11;
          let ndre = ndvi * 0.55 + (rnd() - 0.5) * 0.05;
          let cwsi = E.clamp(0.86 - ratio * 0.55 + (rnd() - 0.5) * 0.16, 0.12, 0.96);
          let death = 0;
          D.PATCHES.filter((pt) => pt.part === b.id).forEach((pt) => {
            const dx = (c / cols - pt.x) / pt.r;
            const dy = (r / rows - pt.y) / pt.r;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 1) {
              const w = 1 - d;
              ndvi -= 0.30 * w;
              ndre -= 0.16 * w;
              cwsi += 0.28 * w;
              if (pt.type === "死亡斑块" && d < 0.55) death = 1;
            }
          });
          healthCells.push({
            part: p.id, partName: p.name, x, y, w: cw, h: ch,
            ndvi: E.clamp(ndvi, 0.06, 0.86), ndre: E.clamp(ndre, 0.03, 0.62),
            cwsi: E.clamp(cwsi, 0.1, 0.98), death
          });
        }
      }
    });
  }

  const RAMPS = {
    ndvi: ["#6b4a26", "#a8793a", "#c9a958", "#8fc47b", "#43bd7c"],
    ndre: ["#4c3a52", "#7a6a6a", "#b1a26c", "#86c48a", "#4fd18e"],
    cwsi: ["#1f7d6c", "#5fb381", "#c9bc5a", "#e08b43", "#e0524c"],
    death: ["#5a4430", "#8a6436", "#b08340", "#6d5a3f", "#c9463d"]
  };

  function rampColor(stops, t) {
    const tt = E.clamp(t, 0, 1);
    const seg = tt * (stops.length - 1);
    const i0 = Math.floor(seg);
    const i1 = Math.min(stops.length - 1, i0 + 1);
    return mixHex(stops[i0], stops[i1], seg - i0);
  }

  function mixHex(a, b, t) {
    const pa = a.replace("#", ""), pb = b.replace("#", "");
    const ar = parseInt(pa.slice(0, 2), 16), ag = parseInt(pa.slice(2, 4), 16), ab = parseInt(pa.slice(4, 6), 16);
    const br = parseInt(pb.slice(0, 2), 16), bg = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
    return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
  }

  function drawHealthMap() {
    buildGrid();
    const cv = $("healthCanvas");
    const ctx = cv.getContext("2d");
    const layer = state.layer;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#0a1315";
    ctx.fillRect(0, 0, cv.width, cv.height);

    // 区块与栅格
    D.MAP_LAYOUT.forEach((b) => {
      const p = D.PARTITIONS.find((x) => x.id === b.id);
      ctx.strokeStyle = "#20343a";
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,.02)";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // 板下区块画板行
      if (p.micro === "under") {
        ctx.fillStyle = "rgba(255,255,255,.05)";
        for (let sx = b.x + 8; sx < b.x + b.w - 8; sx += 14) {
          ctx.fillRect(sx, b.y + 24, 3, b.h - 30);
        }
      }
      ctx.fillStyle = "#93a9ad";
      ctx.font = '11.5px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`${b.id} ${p.name}`, b.x + 7, b.y + 6);
      ctx.fillStyle = "#4f6468";
      ctx.font = '9px "SFMono-Regular",Consolas,monospace';
      ctx.textAlign = "right";
      ctx.fillText(`${nf(p.area)} 亩`, b.x + b.w - 7, b.y + 7);
    });

    // 栅格
    healthCells.forEach((c) => {
      let t;
      if (layer === "ndvi") t = (c.ndvi - 0.05) / 0.8;
      else if (layer === "ndre") t = (c.ndre - 0.03) / 0.58;
      else if (layer === "cwsi") t = (c.cwsi - 0.1) / 0.88;
      else t = c.death ? 1 : (c.ndvi - 0.05) / 0.8 * 0.35;
      ctx.fillStyle = layer === "death" ? (c.death ? "#d2463c" : mixHex("#33281c", "#7c6336", t)) : rampColor(RAMPS[layer], t);
      ctx.globalAlpha = layer === "death" ? (c.death ? 0.95 : 0.75) : 0.92;
      ctx.fillRect(c.x, c.y, c.w - 0.6, c.h - 0.6);
      ctx.globalAlpha = 1;
      if (layer === "death" && c.death) {
        ctx.fillStyle = "#f4b3ac";
        ctx.font = '9px "SFMono-Regular",Consolas,monospace';
        ctx.textAlign = "center";
        ctx.fillText("×", c.x + c.w / 2, c.y + c.h / 2);
      }
    });

    // 指北与比例尺
    ctx.fillStyle = "#7b9195";
    ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = "center";
    ctx.beginPath();
    ctx.moveTo(930, 24); ctx.lineTo(938, 46); ctx.lineTo(930, 42); ctx.lineTo(922, 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillText("N", 930, 56);
    ctx.textAlign = "left";
    ctx.fillStyle = "#4f6468";
    ctx.font = '9.5px "SFMono-Regular",Consolas,monospace';
    ctx.fillText("0", 46, 448);
    ctx.fillRect(46, 438, 90, 2);
    ctx.fillText("500 m", 136, 448);
    ctx.textAlign = "right";
    ctx.fillText("正射影像 · 2027-06-14", 934, 448);
  }

  function renderHealthStats() {
    const total = healthCells.length || 1;
    const bands = [0, 0, 0, 0];
    healthCells.forEach((c) => {
      if (c.cwsi < 0.42) bands[0]++;
      else if (c.cwsi < 0.58) bands[1]++;
      else if (c.cwsi < 0.72) bands[2]++;
      else bands[3]++;
    });
    const items = [
      ["正常", bands[0], "#5fd48a"],
      ["轻度胁迫", bands[1], "#e0c15a"],
      ["中度胁迫", bands[2], "#e39a34"],
      ["重度胁迫", bands[3], "#ef6b63"]
    ];
    $("healthStats").innerHTML = items.map(([k, v, col]) => `
      <div><p>${k}</p><b style="color:${col}">${pct(v / total, 1)}</b></div>`).join("");
    $("patchCountBadge").textContent = `${D.PATCHES.length} 处 · ${nf(D.PATCHES.reduce((s, p) => s + p.areaMu, 0))} 亩`;
  }

  function renderPatchTable() {
    $("patchTable").innerHTML = `
      <thead><tr><th>编号</th><th>位置</th><th class="num">面积</th><th>类型</th><th>等级</th><th>关联</th></tr></thead>
      <tbody>${D.PATCHES.map((p) => `
        <tr>
          <td class="zone">${p.id}</td>
          <td>${D.PARTITIONS.find((x) => x.id === p.part).name}</td>
          <td class="num">${p.areaMu} 亩</td>
          <td>${p.type}</td>
          <td><span class="tag" style="color:${stressColor(p.level)};border-color:${stressColor(p.level)}55">${["", "轻度", "中度", "重度"][p.level]}</span></td>
          <td class="num">${p.part} · ${D.PARTITIONS.find((x) => x.id === p.part).valve}</td>
        </tr>`).join("")}</tbody>`;
  }

  function setLayerLegend() {
    const cfg = {
      ndvi: { stops: RAMPS.ndvi, from: "0.10", to: "0.75", label: "NDVI 归一化植被指数" },
      ndre: { stops: RAMPS.ndre, from: "0.03", to: "0.55", label: "NDRE 红边指数" },
      cwsi: { stops: RAMPS.cwsi, from: "0.10", to: "0.90", label: "CWSI 水分胁迫指数（越高越缺水）" },
      death: { stops: RAMPS.death, from: "正常", to: "死亡", label: "死亡斑块分布" }
    }[state.layer];
    $("scaleLegend").innerHTML = `<div><div style="display:flex;gap:2px">${cfg.stops.map((s) => `<span class="sw" style="background:${s}"></span>`).join("")}</div>
      <div class="scale-labels"><span>${cfg.from}</span><span>${cfg.label}</span><span>${cfg.to}</span></div></div>`;
    $("healthHint").textContent = state.layer === "cwsi"
      ? "热红外冠气温差推算 CWSI，红色区域优先安排补水。"
      : "鼠标移到栅格上可查看该点位指数与关联分区。";
  }

  function bindHealthHover() {
    const cv = $("healthCanvas");
    const tip = $("mapTooltip");
    cv.addEventListener("mousemove", (ev) => {
      const rect = cv.getBoundingClientRect();
      const sx = cv.width / rect.width;
      const sy = cv.height / rect.height;
      const mx = (ev.clientX - rect.left) * sx;
      const my = (ev.clientY - rect.top) * sy;
      const cell = healthCells.find((c) => mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h);
      if (!cell) { tip.style.opacity = 0; return; }
      const lv = E.stressLevelFromRatio((cell.cwsi - 0.1) / 0.88);
      tip.style.opacity = 1;
      tip.style.left = ev.offsetX + "px";
      tip.style.top = ev.offsetY + "px";
      tip.innerHTML = `${cell.part} ${cell.partName}<br>NDVI <b>${cell.ndvi.toFixed(2)}</b> · NDRE <b>${cell.ndre.toFixed(2)}</b><br>
        CWSI <b style="color:${stressColor(lv.level)}">${cell.cwsi.toFixed(2)}</b> · ${lv.label}${cell.death ? " · 死亡" : ""}`;
    });
    cv.addEventListener("mouseleave", () => { tip.style.opacity = 0; });
  }

  /* ---------------- 处方 ---------------- */
  function availableDaily() {
    return E.availableQuota(SITE).daily;
  }

  function renderQuotaBanner() {
    const q = E.availableQuota(SITE);
    const demand = E.totalDemand(state.analysis);
    const usedPct = Math.min(100, (SITE.quota.monthUsed / SITE.quota.monthQuota) * 100);
    const presc = state.prescription;
    $("quotaBanner").innerHTML = `
      <div class="quota-item"><p>本月（${SITE.quota.monthName}）配额</p><b>${wan(SITE.quota.monthQuota)}<small>万 m³</small></b></div>
      <div class="quota-item"><p>本月已用</p><b>${wan(SITE.quota.monthUsed)}<small>万 m³</small></b></div>
      <div class="quota-item"><p>剩余配额 / 剩余 ${SITE.quota.daysLeft} 天</p><b class="amber">${wan(q.remain)}<small>万 m³</small></b></div>
      <div class="quota-item"><p>日均可分配</p><b class="cyan">${nf(Math.round(q.daily))}<small>m³</small></b></div>
      <div class="quota-item"><p>今日蒸散需水</p><b class="${demand > q.daily ? "red" : "green"}">${nf(Math.round(demand))}<small>m³</small></b></div>
      <div class="quota-bar">
        <div class="track"><span style="width:${usedPct}%;background:linear-gradient(90deg,#f2b04b,#e39a34)"></span></div>
        <div class="labels"><span>已用 ${pct(SITE.quota.monthUsed / SITE.quota.monthQuota)}</span>
        <span>${presc ? `今日处方 ${nf(Math.round(presc.summary.allocated))} m³ · 水源峰值 ${nf(presc.summary.peakFlow)} m³/h` : "水源能力 6,500 m³/h"}</span>
        <span>配额 ${wan(SITE.quota.monthQuota)} 万 m³</span></div>
      </div>`;
  }

  function renderPrescription() {
    const box = $("prescTable");
    if (!state.prescription) {
      $("prescSummary").innerHTML = "";
      $("execPanel").innerHTML = `<p class="footnote">尚未生成处方。点击“生成处方”，系统将在配额约束下按优先级排程。</p>`;
      $("execProgress").style.width = "0%";
      $("execNote").textContent = "未生成处方时，执行区保持待命。";
      box.innerHTML = `<thead><tr><th>#</th><th>分区</th><th>阀号</th><th class="num">应灌量</th><th class="num">分配量</th><th class="num">时长</th><th>时段</th><th>状态</th></tr></thead>
        <tbody><tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:26px">等待生成处方</td></tr></tbody>`;
      $("basisPanel").innerHTML = `<p class="empty">选择处方表中的一行，查看这条处方为什么这样开。</p>`;
      $("exportPrescBtn").disabled = true;
      $("generateBtn").disabled = state.executing;
      $("dispatchBtn").disabled = true;
      $("dispatchBtn").textContent = "确认下发";
      $("dispatchBtn").classList.remove("done");
      return;
    }
    const { items, summary } = state.prescription;
    const statusLabel = { full: ["已排程", "st fin"], partial: ["部分满足", "st wait"], deferred: ["顺延", "st"] };
    box.innerHTML = `
      <thead><tr><th>#</th><th>分区 / 阀号</th><th>胁迫</th><th class="num">应灌量 m³</th><th class="num">分配量 m³</th>
      <th class="num">时长</th><th>时段</th><th>排程</th></tr></thead>
      <tbody>${items.map((it, idx) => {
        const st = statusLabel[it.status];
        return `<tr data-idx="${idx}" class="${state.selectedItem && state.selectedItem.key === it.key ? "selected" : ""}">
          <td class="num">${it.order}</td>
          <td class="zone">${it.part}<span style="color:var(--muted-2);font-weight:400"> · ${it.valve}</span></td>
          <td><span class="status-dot"><i style="background:${stressColor(it.stress.level)}"></i>${it.stress.label}</span></td>
          <td class="num">${nf(Math.round(it.required))}</td>
          <td class="num">${it.alloc ? nf(Math.round(it.alloc)) : "—"}</td>
          <td class="num">${it.minutes ? Math.round(it.minutes) + " min" : "—"}</td>
          <td>${it.window ? `${it.window} · ${it.startLabel}` : "—"}</td>
          <td><span class="${st[1]}">${st[0]}</span></td>
        </tr>`;
      }).join("")}</tbody>`;
    $("prescSummary").innerHTML = `
      <div><p>今日分配总量</p><b>${nf(Math.round(summary.allocated))} m³</b></div>
      <div><p>配额执行率</p><b class="${summary.allocated / summary.demand < 0.95 ? "ledger-down" : "ledger-up"}">${pct(summary.allocated / summary.demand)}</b></div>
      <div><p>顺延水量</p><b>${nf(Math.round(summary.deferredVolume))} m³</b></div>
      <div><p>排程阀数 / 顺延</p><b>${summary.fullCount + summary.partialCount} / ${summary.deferredCount}</b></div>`;
    $("exportPrescBtn").disabled = false;
    $("generateBtn").disabled = false;
    if (!state.executing) {
      const scheduled = items.filter((i) => i.alloc > 0).length;
      $("dispatchBtn").disabled = scheduled === 0;
      if (!$("dispatchBtn").classList.contains("done")) $("dispatchBtn").textContent = "确认下发";
    }

    $("execPanel").innerHTML = items.filter((i) => i.alloc > 0).map((i) => `
      <div class="exec-row" data-key="${i.key}">
        <span class="left"><b>${i.valve}</b><span>${i.part}</span></span>
        <span class="st wait" data-st>待下发</span>
      </div>`).join("") || `<p class="footnote">今日无排程。</p>`;
    $("execProgress").style.width = "0%";
    $("execNote").textContent = "处方已生成，等待确认下发。依据链已按 气象 → 墒情 → 配额 → 优先级 固化。";
  }

  function bindPrescTable() {
    $("prescTable").addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-idx]");
      if (!tr || !state.prescription) return;
      const it = state.prescription.items[Number(tr.dataset.idx)];
      state.selectedItem = it;
      document.querySelectorAll("#prescTable tr.selected").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      renderBasis(it);
    });
  }

  function renderBasis(it) {
    const p = state.analysis.find((x) => x.id === it.key);
    const q = E.availableQuota(SITE);
    const why = it.status === "deferred"
      ? "配额已用尽，按优先级顺延至下一灌溉窗口，不平均摊薄。"
      : it.status === "partial"
        ? "剩余配额不足以满足全部需求，按最高优先级给出剩余额度。"
        : "优先级靠前且配额充足，按需水全额分配。";
    $("basisPanel").innerHTML = `
      <div class="basis-list">
        <div><span>参考蒸散 ET₀</span><b>${it.et0.toFixed(2)} mm</b></div>
        <div><span>有效作物系数 Kc</span><b>${it.kc.toFixed(2)}（${microName(it.micro)} · 覆盖度 ${(p ? p.kc.cover * 100 : 0).toFixed(0)}%）</b></div>
        <div><span>日蒸散需水</span><b>${it.mm.toFixed(2)} mm × ${nf(it.area)} 亩 = ${nf(Math.round(it.required))} m³</b></div>
        <div><span>当前含水率 / 田持</span><b>${(p.theta * 100).toFixed(1)}% / ${(p.fc * 100).toFixed(1)}%</b></div>
        <div><span>苗龄 / 作物</span><b>${p.seedAge} 天 · ${p.crop}</b></div>
        <div><span>至胁迫线剩余</span><b>${p.reserve >= 8 ? "8 天以上" : p.reserve + " 天"}</b></div>
        <div><span>胁迫等级 → 优先级</span><b>${it.stress.label} · 优先级分 ${it.priority.toFixed(1)}</b></div>
        <div><span>阀门口径</span><b>${it.valve} · ${nf(it.flow)} m³/h</b></div>
        <div><span>配额依据</span><b>日均 ${nf(Math.round(q.daily))} m³（剩余 ${wan(q.remain)} 万 / ${SITE.quota.daysLeft} 天）</b></div>
      </div>
      <p class="basis-note">${why} 本轮处方量 ${it.alloc ? nf(Math.round(it.alloc)) + " m³" : "0"}，${
        it.minutes ? `预计 ${Math.round(it.minutes)} 分钟（${it.window} 起 ${it.startLabel}）` : "未排程"}。执行后回采流量与墒情，进入下一轮修正。</p>`;
  }

  function generatePrescription() {
    state.prescription = E.buildPrescription(SITE, state.weather, D.CROP_KC);
    state.selectedItem = null;
    $("generateBtn").classList.remove("done");
    $("generateBtn").textContent = "重新生成";
    $("dispatchBtn").classList.remove("done");
    $("dispatchBtn").textContent = "确认下发";
    renderPrescription();
    renderQuotaBanner();
    pushLog("处方生成", `8 个分区、日均配额 ${nf(Math.round(state.prescription.summary.quotaDaily))} m³，生成 ${state.prescription.items.length} 条处方`);
  }

  function execute() {
    if (!state.prescription || state.executing) return;
    state.executing = true;
    $("generateBtn").disabled = true;
    $("dispatchBtn").disabled = true;
    $("dispatchBtn").textContent = "下发中…";
    const rows = Array.from(document.querySelectorAll("#execPanel .exec-row"));
    if (!rows.length) { state.executing = false; return; }
    let i = 0;
    const total = rows.length;
    const finish = () => {
      state.executing = false;
      $("generateBtn").disabled = false;
      $("execProgress").style.width = "100%";
      $("execNote").textContent = "全部处方执行完成。流量与墒情回采将在 30 分钟后自动入库，用于下一轮修正与节水核算。";
      $("generateBtn").classList.add("done");
      $("generateBtn").textContent = "已下发";
      $("dispatchBtn").classList.add("done");
      $("dispatchBtn").textContent = "已执行";
      $("dispatchBtn").disabled = true;
      pushLog("执行完成", `${total} 个阀门按处方完成灌溉，回采数据待入库`);
      renderQuotaBanner();
    };
    const step = () => {
      if (i >= total) return finish();
      const row = rows[i];
      const st = row.querySelector("[data-st]");
      st.className = "st run";
      st.textContent = "执行中";
      $("execProgress").style.width = Math.round(((i + 0.5) / total) * 100) + "%";
      setTimeout(() => {
        st.className = "st fin";
        st.textContent = "已完成";
        const it = state.prescription.items.find((x) => x.key === row.dataset.key);
        pushLog("阀门执行", `${it.valve} ${it.part} 完成 ${Math.round(it.minutes)} 分钟灌溉，约 ${nf(Math.round(it.alloc))} m³`);
        i++;
        $("execProgress").style.width = Math.round((i / total) * 100) + "%";
        step();
      }, 900);
    };
    pushLog("处方下发", $("autoDispatch").checked ? "自动下发模式：已获基地授权，处方直连水肥一体化控制器" : "人工确认模式：值班员确认后下发");
    $("execNote").textContent = "正在按窗口顺序执行，单阀流量受水源能力约束。";
    step();
  }

  function pushLog(type, msg) {
    state.clockMin += 1;
    const time = `${String(Math.floor(state.clockMin / 60)).padStart(2, "0")}:${String(state.clockMin % 60).padStart(2, "0")}`;
    state.logs.unshift({ time, type, msg });
    renderLog();
  }

  function renderLog() {
    $("execLog").innerHTML = state.logs.map((l) => `
      <div class="log-row"><time>${l.time}</time><strong>${l.type}</strong><p>${l.msg}</p></div>`).join("");
  }

  /* ---------------- 核算 ---------------- */
  function renderAccounting() {
    const t = E.ledgerTotals(D.LEDGER);
    const cp = D.CONTROL_PLOT;
    const cards = [
      { label: "基准用水（定时定量）", value: wan(t.baseline), unit: "万 m³", note: "对照区同步计量", accent: "#7b9195" },
      { label: "处方灌溉实际用水", value: wan(t.actual), unit: "万 m³", note: "分区流量计累计", accent: "#45c8d6" },
      { label: "累计节水量", value: wan(t.saved), unit: "万 m³", note: "同季同基地差值", accent: "#5fd48a" },
      { label: "节水率", value: pct(t.savingRate), note: "目标 ≥25%", accent: "#5fd48a" },
      { label: "植被增产率", value: pct((cp.yieldRx - cp.yieldBase) / cp.yieldBase), note: "对照区 NDVI 0.38 → 0.43", accent: "#f2b04b" },
      { label: "节省水费", value: (t.savedCost / 10000).toFixed(1), unit: "万元", note: `按 ${SITE.quota.waterPrice} 元/m³ 计`, accent: "#f2b04b" }
    ];
    $("accountKpi").innerHTML = cards.map((c) => `
      <div class="kpi" style="--kpi-accent:${c.accent}">
        <p>${c.label}</p><strong>${c.value}${c.unit ? `<small>${c.unit}</small>` : ""}</strong><em>${c.note}</em>
      </div>`).join("");

    C.barChart($("accountChart"), {
      labels: D.LEDGER.map((r) => r.period.replace(" ", "")),
      series: [
        { name: "基准", color: "#3d5054", data: D.LEDGER.map((r) => r.baseline) },
        { name: "处方", color: "#45c8d6", data: D.LEDGER.map((r) => r.actual) }
      ]
    });
    $("accountNote").innerHTML = `累计基准用水 <b>${wan(t.baseline)} 万 m³</b>，处方灌溉 <b>${wan(t.actual)} 万 m³</b>，节水量 <b>${wan(t.saved)} 万 m³</b>。` +
      `节水率已高于第一年 ≥25% 的立项目标；对照区 NDVI 由 ${cp.ndviBase.toFixed(2)} 提升至 ${cp.ndviRx.toFixed(2)}，产量指数 ${(cp.yieldRx - cp.yieldBase).toFixed(1)}%。`;

    const rows = D.LEDGER.map((r) => {
      const save = (r.baseline - r.actual) / r.baseline;
      return `<tr><td>${r.period}</td><td class="num">${r.rain.toFixed(1)}</td>
        <td class="num">${nf(r.baseline)}</td><td class="num">${nf(r.actual)}</td>
        <td class="num ledger-up">${pct(save)}</td>
        <td class="num">${((r.baseline - r.actual) * SITE.quota.waterPrice).toFixed(0)}</td></tr>`;
    }).join("");
    $("ledgerTable").innerHTML = `
      <thead><tr><th>时段</th><th class="num">降水 mm</th><th class="num">基准 m³</th><th class="num">处方 m³</th><th class="num">节水率</th><th class="num">省水费 元</th></tr></thead>
      <tbody>${rows}<tr><td><b>累计</b></td><td class="num">${D.LEDGER.reduce((s, r) => s + r.rain, 0).toFixed(1)}</td>
      <td class="num"><b>${nf(t.baseline)}</b></td><td class="num"><b>${nf(t.actual)}</b></td>
      <td class="num ledger-up"><b>${pct(t.savingRate)}</b></td><td class="num"><b>${nf(t.savedCost)}</b></td></tr></tbody>`;
  }

  /* ---------------- 设备 ---------------- */
  const ICONS = {
    nodes: '<path d="M8 3v10M8 8c0 3 5 3 5 6" stroke="#45c8d6" stroke-width="1.6" fill="none"/><circle cx="13" cy="15" r="2.2" fill="#45c8d6"/>',
    valves: '<circle cx="10" cy="10" r="5.5" stroke="#5fd48a" stroke-width="1.5" fill="none"/><path d="M10 4.5v11M4.5 10h11" stroke="#5fd48a" stroke-width="1.4"/>',
    edge: '<rect x="3" y="5" width="14" height="10" rx="2" stroke="#f2b04b" stroke-width="1.5" fill="none"/><rect x="6" y="8" width="8" height="4" rx="1" fill="#f2b04b" opacity=".6"/>',
    weather: '<circle cx="10" cy="8" r="3.4" fill="#a78bfa"/><path d="M10 2v1.5M10 12.5V14M4 8h1.5M14.5 8H16M5.8 3.8l1 1M13.2 12.2l1 1M14.2 3.8l-1 1M6.8 12.2l-1 1" stroke="#a78bfa" stroke-width="1.2"/>',
    flow: '<path d="M10 3c3 4 5 5.6 5 8a5 5 0 0 1-10 0c0-2.4 2-4 5-8z" stroke="#45c8d6" stroke-width="1.5" fill="none"/>',
    drone: '<path d="M6 7l8 6M14 7l-8 6" stroke="#5fd48a" stroke-width="1.3"/><rect x="8" y="8.5" width="4" height="3" rx="1" fill="#5fd48a"/><circle cx="5" cy="6" r="2" stroke="#5fd48a" stroke-width="1.2" fill="none"/><circle cx="15" cy="6" r="2" stroke="#5fd48a" stroke-width="1.2" fill="none"/>'
  };

  function renderDevices() {
    $("deviceGrid").innerHTML = D.DEVICES.map((d) => `
      <div class="device-card">
        <span class="dev-state">${d.online}/${d.total} 在线</span>
        <div class="dev-ico"><svg viewBox="0 0 20 20">${ICONS[d.key]}</svg></div>
        <h4>${d.name}</h4>
        <div class="dev-num">${d.online}<small> / ${d.total}</small></div>
        <p>${d.note}</p>
      </div>`).join("");

    const b = D.EDGE_BOX;
    $("edgeDetail").innerHTML = [
      ["运行时长", b.uptime.replace("运行 ", "")],
      ["断网连续运行", b.offlineRun.replace("断网连续运行 ", "")],
      ["本地缓存", b.cache.replace("缓存 ", "")],
      ["推理时延", b.latency],
      ["模型", b.model],
      ["CPU / 磁盘", `${b.cpu} / ${b.disk}`],
      ["最近同步", b.lastSync]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

    $("offlineTable").innerHTML = `
      <thead><tr><th>节点</th><th>位置</th><th>离线</th><th>初判原因</th></tr></thead>
      <tbody>${D.OFFLINE_NODES.map((n) => `<tr><td class="zone">${n.node}</td><td>${n.part}</td><td>${n.since}</td><td>${n.cause}</td></tr>`).join("")}</tbody>`;

    $("integrationList").innerHTML = D.INTEGRATIONS.map((i) => `
      <div><span>${i.name}<em style="display:block;font-style:normal;font-size:10px;color:var(--muted-2)">${i.protocol}</em></span>
      <b class="${i.ok ? "ok-tag" : "warn-tag"}">${i.status}</b></div>`).join("");

    const total = D.DEVICES.reduce((s, d) => s + d.total, 0);
    const online = D.DEVICES.reduce((s, d) => s + d.online, 0);
    $("systemMeta").textContent = `设备在线率 ${pct(online / total)} · 断网可运行 7 天`;
  }

  /* ---------------- 导出 ---------------- */
  function downloadCSV(filename, rows) {
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportPrescription() {
    if (!state.prescription) return;
    const rows = [["序号", "分区", "阀号", "应灌量(m³)", "分配量(m³)", "时长(min)", "时段", "状态", "优先级分", "依据"]];
    state.prescription.items.forEach((i) => rows.push([
      i.order, i.part, i.valve, Math.round(i.required), Math.round(i.alloc),
      Math.round(i.minutes), i.window ? `${i.window} ${i.startLabel}-${i.endLabel}` : "顺延",
      { full: "已排程", partial: "部分满足", deferred: "顺延" }[i.status],
      i.priority.toFixed(1),
      `ET0 ${i.et0.toFixed(2)}mm, Kc ${i.kc.toFixed(2)}, ${i.stress.label}胁迫, 余水${i.reserve}天`
    ]));
    downloadCSV("光下绿洲_灌溉处方_20270615.csv", rows);
    pushLog("处方导出", "灌溉处方已导出 CSV，供值班室签字归档");
  }

  function exportLedger() {
    const t = E.ledgerTotals(D.LEDGER);
    const rows = [["时段", "降水(mm)", "基准用水(m³)", "处方用水(m³)", "节水量(m³)", "节水率(%)", "节省水费(元)"]];
    D.LEDGER.forEach((r) => rows.push([
      r.period, r.rain.toFixed(1), r.baseline, r.actual, r.baseline - r.actual,
      (((r.baseline - r.actual) / r.baseline) * 100).toFixed(1),
      ((r.baseline - r.actual) * SITE.quota.waterPrice).toFixed(0)
    ]));
    rows.push(["累计", D.LEDGER.reduce((s, r) => s + r.rain, 0).toFixed(1), t.baseline, t.actual, t.saved,
      (t.savingRate * 100).toFixed(1), t.savedCost.toFixed(0)]);
    downloadCSV("光下绿洲_节水台账_2027.csv", rows);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    document.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.goto));
    });
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + tab));
    // 页面从隐藏变为可见后，重绘 canvas 以获取正确宽度
    requestAnimationFrame(() => {
      if (tab === "overview") { renderForecastChart(); renderOverviewPartitions(); }
      if (tab === "demand") { renderMoistureChart(); renderBalanceTable(); }
      if (tab === "health") { drawHealthMap(); }
      if (tab === "prescription") { renderQuotaBanner(); }
      if (tab === "accounting") { renderAccounting(); }
      if (tab === "system") { renderDevices(); }
    });
  }

  function bindWeather() {
    const pairs = [
      ["wx-tmax", "tmax", "v-tmax", 1], ["wx-tmin", "tmin", "v-tmin", 1],
      ["wx-rh", "rh", "v-rh", 0], ["wx-wind", "wind", "v-wind", 1], ["wx-rs", "rs", "v-rs", 1]
    ];
    pairs.forEach(([id, key, vId, d]) => {
      const input = $(id);
      input.addEventListener("input", () => {
        state.weather[key] = parseFloat(input.value);
        $(vId).textContent = parseFloat(input.value).toFixed(d);
        weatherChanged();
      });
    });
  }

  function weatherChanged() {
    state.prescription = null;
    state.selectedItem = null;
    refresh();
    renderForecastChart();
    renderOverviewPartitions();
    renderQuotaBanner();
    renderPrescription();
    renderAlerts();
    $("weatherBrief").textContent = `${state.weather.tmax.toFixed(1)} / ${state.weather.tmin.toFixed(1)} ℃ · 风速 ${state.weather.wind.toFixed(1)} m/s · 辐射 ${state.weather.rs.toFixed(1)} MJ/m²`;
  }

  function bindLayerTabs() {
    document.querySelectorAll("#layerTabs .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#layerTabs .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        state.layer = chip.dataset.layer;
        setLayerLegend();
        drawHealthMap();
      });
    });
  }

  function init() {
    // 气象显示同步
    ["tmax", "tmin", "rh", "wind", "rs"].forEach((k) => {
      const el = $("v-" + k);
      if (el) el.textContent = parseFloat(state.weather[k]).toFixed(k === "rh" ? 0 : 1);
    });
    $("shadeVal").textContent = Math.round(SITE.panels.shadeRatio * 100) + "%";
    $("scenarioTime").textContent = SITE.scenarioTime;

    state.analysis = E.analyzeAll(SITE, state.weather, D.CROP_KC);
    renderKpis();
    renderForecastChart();
    renderOverviewPartitions();
    renderAlerts();
    renderInspect();
    renderEdgeSummary();
    renderDemand();
    renderQuotaBanner();
    renderPrescription();
    renderLog();

    buildGrid();
    drawHealthMap();
    setLayerLegend();
    renderPatchTable();
    renderHealthStats();
    renderAccounting();
    renderDevices();

    bindTabs();
    bindWeather();
    bindLayerTabs();
    bindHealthHover();
    bindPrescTable();

    $("forecastPartition").addEventListener("change", () => { renderMoistureChart(); renderBalanceTable(); });
    $("generateBtn").addEventListener("click", generatePrescription);
    $("dispatchBtn").addEventListener("click", execute);
    $("exportPrescBtn").addEventListener("click", exportPrescription);
    $("exportLedgerBtn").addEventListener("click", exportLedger);
    $("autoDispatch").addEventListener("change", (e) => {
      state.autoDispatch = e.target.checked;
      $("prescriptionModeMeta").textContent = state.autoDispatch
        ? "当前模式：自动下发（已获书面授权）"
        : "当前模式：建议 + 人工确认";
    });

    // 数据源切换
    bindSourceSwitch();

    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (state.tab === "overview") renderForecastChart();
        if (state.tab === "demand") renderMoistureChart();
        if (state.tab === "accounting") renderAccounting();
      }, 180);
    });

    // 支持 ?tab=xxx 深链接（用于演示与巡检）
    const params = new URLSearchParams(window.location.search);
    const deepTab = params.get("tab");
    if (deepTab && document.getElementById("page-" + deepTab)) switchTab(deepTab);
    if (params.get("generate") === "1") setTimeout(generatePrescription, 60);
  }

  /* ---------------- 数据源接入 ---------------- */
  function bindSourceSwitch() {
    document.querySelectorAll(".src-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".src-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const src = btn.dataset.src;
        DataAdapter.setSource(src);
        if (src === "file") openFilePicker();
        updateSourceStatus();
      });
    });
    DataAdapter.onChange(updateSourceStatus);
    updateSourceStatus();
  }

  function updateSourceStatus() {
    const s = DataAdapter.getState();
    const pill = $("edgeStatus");
    if (s.source === "sim") {
      pill.className = "status-pill";
      pill.innerHTML = "<i></i>模拟数据";
    } else if (s.source === "http") {
      if (s.connected) {
        pill.className = "status-pill";
        pill.innerHTML = "<i></i>API 已连接";
      } else {
        pill.className = "status-pill offline";
        pill.innerHTML = "<i></i>API 离线";
      }
    } else {
      pill.className = "status-pill";
      pill.innerHTML = "<i></i>文件模式";
    }
  }

  function openFilePicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.csv";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await DataAdapter.importFile(file);
        if (Array.isArray(data) && data.length && data[0].partId) {
          applyRealSoilData(data);
          pushLog("文件导入", `已导入 ${data.length} 条墒情记录（${file.name}）`);
        } else if (data.weather) {
          applyRealWeatherData(data.weather);
          pushLog("文件导入", `已导入气象数据（${file.name}）`);
        } else {
          alert("文件格式无法识别，请导入包含 partId 的 JSON/CSV");
        }
      } catch (err) {
        alert("导入失败：" + err.message);
      }
    };
    input.click();
  }

  function applyRealSoilData(records) {
    // 同一分区可能有多个节点，按 partId 聚合取均值
    const acc = {};
    records.forEach((r) => {
      if (typeof r.theta !== "number") return;
      (acc[r.partId] = acc[r.partId] || []).push(r.theta);
    });
    Object.entries(acc).forEach(([pid, arr]) => {
      const p = D.PARTITIONS.find((x) => x.id === pid);
      if (p) p.theta = arr.reduce((s, v) => s + v, 0) / arr.length;
    });
    state.analysis = E.analyzeAll(SITE, state.weather, D.CROP_KC);
    refresh();
    renderAlerts();
  }

  function applyRealWeatherData(w) {
    Object.assign(state.weather, w);
    ["tmax", "tmin", "rh", "wind", "rs"].forEach((k) => {
      const el = $("v-" + k);
      if (el && w[k] !== undefined) el.textContent = parseFloat(w[k]).toFixed(k === "rh" ? 0 : 1);
      const slider = $("wx-" + k);
      if (slider && w[k] !== undefined) slider.value = w[k];
    });
    weatherChanged();
  }

  // HTTP 模式下定时拉取真实数据
  let pulling = false;
  let lastConnected = false;
  async function pullRealData() {
    if (pulling) return;
    if (DataAdapter.getState().source !== "http") return;
    if (!DataAdapter.getState().connected) return;
    pulling = true;
    try {
      const [soilData, weatherData] = await Promise.all([
        DataAdapter.soil(),
        DataAdapter.weather()
      ]);
      if (Array.isArray(soilData) && soilData.length) applyRealSoilData(soilData);
      if (weatherData && weatherData.tmax !== undefined) applyRealWeatherData(weatherData);
    } catch (e) {
      // 静默失败，保持当前数据
    } finally {
      pulling = false;
    }
  }
  // 连接建立（或切换到 API 模式）后立即拉取一轮
  DataAdapter.onChange((s) => {
    if (s.source === "http" && s.connected && !lastConnected) pullRealData();
    lastConnected = s.source === "http" && s.connected;
  });
  setInterval(pullRealData, 15000);

  document.addEventListener("DOMContentLoaded", init);
})();
