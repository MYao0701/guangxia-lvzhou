/* 光下绿洲 · 移动工作站逻辑
 * 复用 js/data.js（仿真数据）、js/engine.js（真实算法）、js/adapter.js（数据源接入）
 */
(function () {
  const D = window.DATA;
  const E = window.Engine;
  const A = window.DataAdapter;
  const $ = (id) => document.getElementById(id);

  const state = {
    weather: { ...D.WEATHER },
    analysis: null,
    prescription: null,
    tab: "home"
  };

  const nf = (n, d) => Number(n).toLocaleString("zh-CN", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const wan = (n, d) => (Number(n) / 10000).toFixed(d === undefined ? 1 : d);
  const pct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + "%";
  const microName = (m) => ({ under: "板下", between: "板间", edge: "板缘" }[m]);
  const stressColor = (lv) => ["#2fa96f", "#d9a520", "#e07a2f", "#e05a3a"][lv];

  /* ---------- 数据接入 ---------- */
  function renderPill() {
    const s = A.getState();
    const pill = $("srcPill");
    if (s.source === "http") {
      pill.textContent = s.connected ? "● 实时数据" : "● 离线·模拟";
      pill.className = "pill" + (s.connected ? "" : " off");
    } else {
      pill.textContent = "● 模拟数据";
      pill.className = "pill";
    }
  }

  function applySoil(records) {
    const acc = {};
    records.forEach((r) => {
      if (typeof r.theta !== "number") return;
      (acc[r.partId] = acc[r.partId] || []).push(r.theta);
    });
    Object.entries(acc).forEach(([pid, arr]) => {
      const p = D.PARTITIONS.find((x) => x.id === pid);
      if (p) p.theta = arr.reduce((s, v) => s + v, 0) / arr.length;
    });
  }

  async function pull() {
    const s = A.getState();
    if (s.source !== "http" || !s.connected) return;
    try {
      const [soil, wx] = await Promise.all([A.soil(), A.weather()]);
      if (Array.isArray(soil) && soil.length) applySoil(soil);
      if (wx && wx.tmax !== undefined) {
        ["tmax", "tmin", "rh", "wind", "rs", "rain"].forEach((k) => {
          if (wx[k] !== undefined) state.weather[k] = wx[k];
        });
      }
      refresh();
    } catch (e) { /* 保持当前数据 */ }
  }

  /* ---------- 渲染 ---------- */
  function refresh() {
    state.analysis = E.analyzeAll(D.SITE, state.weather, D.CROP_KC);
    renderHome();
    renderSoil();
    renderWater();
    if (state.prescription) renderRx();
  }

  function renderHome() {
    const t = E.ledgerTotals(D.LEDGER);
    const demand = E.totalDemand(state.analysis);
    const q = E.availableQuota(D.SITE);
    const severe = state.analysis.filter((p) => p.stress.level === 3).length;
    const cards = [
      { label: "灌溉节水率", v: pct(t.savingRate), u: "", note: "本生长季累计" },
      { label: "今日蒸散需水", v: wan(demand), u: " 万m³", note: "8 个分区合计" },
      { label: "日均可分配配额", v: wan(q.daily), u: " 万m³", note: `本月剩 ${wan(q.remain)} 万 · ${D.SITE.quota.daysLeft} 天` },
      { label: "重度缺水分区", v: severe, u: " 个", note: severe ? "需优先灌溉" : "墒情总体正常" }
    ];
    $("kpiGrid").innerHTML = cards.map((c) => `
      <div class="kpi"><p>${c.label}</p><b>${c.v}<small>${c.u}</small></b><em>${c.note}</em></div>`).join("");

    const items = [];
    state.analysis.filter((p) => p.stress.level === 3).forEach((p) => items.push({
      c: "#e05a3a", t: `${p.name} 重度缺水，可撑约 ${p.reserve} 天`,
      d: `含水率 ${(p.theta * 100).toFixed(1)}%（凋萎 ${(p.wp * 100).toFixed(0)}%）· 今日需 ${nf(p.m3)} m³`
    }));
    items.push({ c: "#d9a520", t: "SN-07 墒情节点离线 18 小时", d: "板下·中区 · 初判风沙掩埋，已派单" });
    if (demand > q.daily) items.push({ c: "#d9a520", t: `今日配额缺口约 ${nf(demand - q.daily)} m³`, d: "处方按优先级分配，轻度分区顺延" });
    $("alertList").innerHTML = items.slice(0, 3).map((a) => `
      <div class="alert"><i style="background:${a.c}"></i><div><p>${a.t}</p><em>${a.d}</em></div></div>`).join("");

    const rows = state.analysis.slice().sort((a, b) => a.reserve - b.reserve).slice(0, 4);
    $("quickList").innerHTML = rows.map(partRow).join("");
  }

  function partRow(p) {
    const col = stressColor(p.stress.level);
    return `<div class="prow">
      <div class="prow-head">
        <b>${p.name}<span class="tag">${microName(p.micro)} · ${p.crop}</span></b>
        <span class="theta" style="color:${col}">${(p.theta * 100).toFixed(1)}%</span>
      </div>
      <div class="bar"><span style="width:${Math.round(p.ratio * 100)}%;background:${col}"></span></div>
      <div class="prow-meta">
        <span>田持 ${(p.fc * 100).toFixed(0)}% · 凋萎 ${(p.wp * 100).toFixed(0)}%</span>
        <span style="color:${col}">${p.stress.label} · 可撑 ${p.reserve >= 8 ? "8+" : p.reserve} 天</span>
      </div>
    </div>`;
  }

  function renderSoil() {
    const s = A.getState();
    $("soilHint").textContent = s.source === "http" && s.connected
      ? "数据来自田间传感器，每 15 秒刷新 · " + new Date().toTimeString().slice(0, 8)
      : "当前为内置仿真数据（点击右上角切换数据源）";
    $("soilList").innerHTML = `<div class="card">` +
      state.analysis.slice().sort((a, b) => b.area - a.area).map(partRow).join("") +
      `</div>`;
  }

  function renderWater() {
    const E0 = E.et0(D.SITE, state.weather, D.SITE.doy);
    $("et0Value").textContent = E0.value.toFixed(2);
    $("et0Terms").innerHTML = [
      ["净辐射 Rn", E0.Rn.toFixed(2) + " MJ"],
      ["水汽压差 VPD", E0.vpd.toFixed(2) + " kPa"],
      ["气温", `${state.weather.tmin.toFixed(0)}~${state.weather.tmax.toFixed(0)} ℃`],
      ["湿度 / 风速", `${state.weather.rh.toFixed(0)}% / ${state.weather.wind.toFixed(1)} m/s`]
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

    const q = E.availableQuota(D.SITE);
    $("quotaLine").textContent = `日均配额 ${nf(q.daily)} m³`;
    const fc = E.dailyDemandForecast(D.SITE, state.weather, D.CROP_KC);
    const today = E.totalDemand(state.analysis);
    const rows = [{ label: "今日", rain: state.weather.rain || 0, m3: today }, ...fc];
    const max = Math.max(...rows.map((r) => r.m3), q.daily);
    $("fcBars").innerHTML = rows.map((r) => {
      const over = r.m3 > q.daily;
      return `<div class="fc-row">
        <label>${r.label}</label>
        <div class="bar"><span style="width:${Math.round(r.m3 / max * 100)}%;background:${over ? "#e05a3a" : "#2b9db5"}"></span></div>
        <b>${nf(r.m3)}</b>
        <span class="rain">${r.rain > 0 ? "雨" + r.rain.toFixed(1) : ""}</span>
      </div>`;
    }).join("");

    $("demandList").innerHTML = state.analysis.map((p) => `
      <div class="d-row">
        <div>${p.name}<small>${microName(p.micro)} · ${nf(p.area)} 亩 · Kc ${p.kc.total.toFixed(2)}</small></div>
        <span class="num">${nf(p.m3)} m³</span>
      </div>`).join("");
  }

  function renderRx() {
    const rx = state.prescription;
    if (!rx) {
      $("rxSummary").innerHTML = `<div class="empty">按上方按钮，基于实时墒情与剩余配额生成今日处方</div>`;
      $("rxList").innerHTML = "";
      return;
    }
    const s = rx.summary;
    const rate = s.demand > 0 ? s.allocated / s.demand : 0;
    const sums = [
      { label: "分配总量", v: nf(s.allocated), u: " m³" },
      { label: "配额执行率", v: pct(rate), u: "", warn: rate < 0.95 },
      { label: "顺延水量", v: nf(s.deferredVolume), u: " m³" },
      { label: "峰值流量", v: nf(s.peakFlow), u: " m³/h" }
    ];
    $("rxSummary").innerHTML = `<div class="rx-sum">` + sums.map((c) => `
      <div class="kpi" style="border-top-color:${c.warn ? "#e05a3a" : "var(--green-2)"}">
        <p>${c.label}</p><b>${c.v}<small>${c.u}</small></b>
      </div>`).join("") + `</div>`;

    const STATUS = { full: ["足额", "#2fa96f"], partial: ["部分", "#d9a520"], deferred: ["顺延", "#e05a3a"] };
    $("rxList").innerHTML = `<div class="card"><div class="card-title">排程明细（水源上限 ${nf(D.SITE.source.maxFlow)} m³/h）</div>` +
      rx.items.map((i) => {
        const [label, col] = STATUS[i.status];
        return `<div class="rx-item">
          <div class="valve">${i.valve}</div>
          <div class="info">
            <b>${i.part}</b>
            <small>${i.start ? `${i.window} · ${i.startLabel}-${i.endLabel}` : "本窗口无可排时间，顺延"}</small>
          </div>
          <div class="amt">
            <b>${i.alloc > 0 ? nf(i.alloc) : 0} m³</b>
            <small><span class="badge" style="background:${col}">${label}</span></small>
          </div>
        </div>`;
      }).join("") + `</div>`;
  }

  /* ---------- 交互 ---------- */
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      state.tab = btn.dataset.tab;
      $("tab-" + state.tab).classList.add("active");
    });
  });

  $("srcPill").addEventListener("click", () => {
    const s = A.getState();
    A.setSource(s.source === "http" ? "sim" : "http");
    renderPill();
  });

  $("genBtn").addEventListener("click", () => {
    state.prescription = E.buildPrescription(D.SITE, state.weather, D.CROP_KC);
    renderRx();
  });

  /* ---------- 启动 ---------- */
  // 本机运行时默认尝试接真实后端，失败自动降级为模拟数据；
  // 部署到公网（如 GitHub Pages）时默认使用内置仿真数据，
  // 避免向 localhost 发起请求被 HTTPS 混合内容策略拦截
  const isLocalRun = location.protocol === "file:" ||
    ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocalRun && A.getState().source === "sim" && !localStorage.getItem("gxlv_data_source")) {
    A.setSource("http");
  }
  A.onChange((s) => {
    renderPill();
    if (s.source === "http" && s.connected) pull();
  });
  setInterval(pull, 15000);
  renderPill();
  renderRx();
  refresh();
})();
