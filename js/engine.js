/* 光下绿洲 · 计算引擎
 * 真实口径：FAO-56 Penman-Monteith 参考蒸散、分区作物系数、土壤水量平衡、配额约束处方优化
 */
(function () {
  const SIGMA = 4.903e-9; // MJ K-4 m-2 day-1
  const MU_TO_M2 = 666.667;
  const rad = (d) => (d * Math.PI) / 180;
  const satVp = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function extraterrestrial(lat, doy) {
    const phi = rad(lat);
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
    const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
    const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(decl), -1, 1));
    const Ra =
      (24 * 60 / Math.PI) * 0.082 * dr *
      (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
    return { Ra, dr, decl, ws };
  }

  /** FAO-56 日尺度参考蒸散量 ET0（mm/day） */
  function et0(site, w, doy) {
    const { lat, elev } = site;
    const J = doy || site.doy;
    const { Ra } = extraterrestrial(lat, J);
    const Rso = Math.max(0.5, (0.75 + 2e-5 * elev) * Ra);
    const tmean = (w.tmax + w.tmin) / 2;
    const P = 101.3 * Math.pow((293 - 0.0065 * elev) / 293, 5.26); // kPa
    const gamma = 0.665e-3 * P;
    const es = (satVp(w.tmax) + satVp(w.tmin)) / 2;
    const ea = Math.max(0.05, es * w.rh / 100);
    const delta = (4098 * satVp(tmean)) / Math.pow(tmean + 237.3, 2);
    const RsRso = clamp(w.rs / Rso, 0.25, 1.0);
    const Rns = 0.77 * w.rs;
    const Rnl =
      SIGMA * ((Math.pow(w.tmax + 273.16, 4) + Math.pow(w.tmin + 273.16, 4)) / 2) *
      (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * RsRso - 0.35);
    const Rn = Math.max(0, Rns - Rnl);
    const vpd = Math.max(0.01, es - ea);
    const num = 0.408 * delta * Rn + gamma * (900 / (tmean + 273)) * w.wind * vpd;
    const den = delta + gamma * (1 + 0.34 * w.wind);
    const value = Math.max(0, num / den);
    return { value, Ra, Rso, RsRso, Rn, Rns, Rnl, delta, gamma, es, ea, vpd, P, tmean };
  }

  /** 光伏微生境对作物系数的修正 */
  function microFactor(micro, shadeRatio) {
    if (micro === "under") return 0.52 + 0.25 * (1 - shadeRatio); // 遮阴 + 集雨
    if (micro === "between") return 1.10 + 0.15 * shadeRatio; // 反射 + 风场
    return 1.18 + 0.10 * shadeRatio; // 板缘更曝晒
  }

  /** 分区有效作物系数 Kc × 微生境 × 覆盖度 */
  function effectiveKc(p, site, cropKc) {
    const base = cropKc[p.crop] || 0.85;
    return {
      base,
      micro: microFactor(p.micro, site.panels.shadeRatio),
      cover: p.cover,
      total: base * microFactor(p.micro, site.panels.shadeRatio) * p.cover
    };
  }

  function moistureRatio(p) {
    return clamp((p.theta - p.wp) / (p.fc - p.wp), 0, 1);
  }

  function stressLevelFromRatio(r) {
    if (r >= 0.58) return { level: 0, label: "正常" };
    if (r >= 0.46) return { level: 1, label: "轻度" };
    if (r >= 0.30) return { level: 2, label: "中度" };
    return { level: 3, label: "重度" };
  }

  /** 土壤水量平衡预测（不灌溉情景），用于“还能撑几天” */
  function forecastReserve(p, site, weather, cropKc) {
    const kc = effectiveKc(p, site, cropKc);
    const et = et0(site, weather, site.doy).value * kc.total; // mm/day
    const stressTheta = p.wp + 0.30 * (p.fc - p.wp);
    let theta = p.theta;
    const series = [theta];
    let days = 0;
    for (let i = 0; i < 7; i++) {
      theta = theta - et / (p.rootDepth * 1000);
      // 若次日有雨，按 75% 有效降水折算
      const f = window.DATA.FORECAST[i];
      if (f && f.rain > 0) theta += (f.rain * 0.75) / (p.rootDepth * 1000);
      series.push(clamp(theta, 0, 0.45));
      if (theta < stressTheta && days === 0) days = i + 1;
    }
    if (days === 0) days = 8; // 8 天以上
    return { series, days, stressTheta, et, stressThetaRatio: 0.30 };
  }

  /** 单分区当日需水与优先级 */
  function analyze(p, site, weather, weatherNow, cropKc) {
    const kc = effectiveKc(p, site, cropKc);
    const E = et0(site, weather || weatherNow, site.doy);
    const mm = E.value * kc.total;
    const r = moistureRatio(p);
    const st = stressLevelFromRatio(r);
    const reserve = forecastReserve(p, site, weatherNow, cropKc);
    // 胁迫越重，允许少量恢复性补水
    const recovery = st.level === 3 ? 1.25 : st.level === 2 ? 1.12 : 1.0;
    const needMm = mm * recovery;
    const m3 = needMm * p.area * MU_TO_M2 / 1000;
    const deficitMm = Math.max(0, (p.wp + 0.72 * (p.fc - p.wp) - p.theta)) * p.rootDepth * 1000;
    const deficitM3 = deficitMm * p.area * MU_TO_M2 / 1000;
    const soilFactor = p.soil === "风沙土" ? 1.0 : p.soil === "砂壤土" ? 0.5 : 0.2;
    const ageFactor = (p.seedAge || 60) < 50 ? 8 : (p.seedAge || 60) < 65 ? 4 : 0;
    const priority = st.level * 100 + (1 - r) * 40 + soilFactor * 6 + ageFactor;
    const duration = (m3 / p.flow) * 60; // 分钟
    return {
      ...p, et0: E.value, kc, mm, needMm, m3, deficitMm, deficitM3,
      ratio: r, stress: st, reserve: reserve.days, duration, priority, recovery
    };
  }

  function analyzeAll(site, weather, cropKc) {
    return window.DATA.PARTITIONS.map((p) => analyze(p, site, weather, weather, cropKc));
  }

  function totalDemand(list) {
    return list.reduce((s, x) => s + x.m3, 0);
  }

  /** 今日可用配额 = 本月剩余配额 / 剩余天数 */
  function availableQuota(site) {
    const q = site.quota;
    const remain = Math.max(0, q.monthQuota - q.monthUsed);
    return { remain, daily: remain / Math.max(1, q.daysLeft) };
  }

  /** 配额约束下的处方优化：优先级贪心 + 水源并发约束排程 */
  function buildPrescription(site, weather, cropKc) {
    const list = analyzeAll(site, weather, cropKc).sort((a, b) => b.priority - a.priority);
    const { daily } = availableQuota(site);
    let left = daily;
    const items = [];
    list.forEach((p, idx) => {
      const full = p.m3;
      let alloc = 0;
      if (left >= full) {
        alloc = full;
      } else if (left > 0 && left >= full * 0.25) {
        alloc = left; // 余量不足时只给高优先级分区
      }
      if (alloc > 0) left -= alloc;
      const minutes = (alloc / p.flow) * 60;
      items.push({
        key: p.id, part: p.name, valve: p.valve, micro: p.micro, area: p.area,
        flow: p.flow, required: full, alloc, minutes,
        priority: p.priority, stress: p.stress, ratio: p.ratio, reserve: p.reserve,
        et0: p.et0, kc: p.kc.total, mm: p.needMm,
        status: alloc <= 0 ? "deferred" : alloc < full * 0.995 ? "partial" : "full",
        window: null, start: null, end: null, order: idx + 1
      });
    });

    // 排程：两个灌溉窗口，任一时刻总流量不超过水源能力
    const cap = site.source.maxFlow;
    const pending = items.filter((i) => i.minutes > 0.5);
    const placed = [];
    site.windows.forEach((win) => {
      const jobs = [];
      pending.forEach((it) => {
        if (placed.includes(it)) return;
        let chosen = null;
        for (let t = win.start * 60; t <= win.end * 60 - it.minutes; t += 10) {
          let peak = 0;
          for (let m = t; m < t + it.minutes; m += 10) {
            let load = it.flow;
            jobs.forEach((j) => {
              if (m >= j.s && m < j.e) load += j.flow;
            });
            peak = Math.max(peak, load);
          }
          if (peak <= cap) { chosen = t; break; }
        }
        if (chosen !== null) {
          const job = { it, s: chosen, e: chosen + it.minutes, flow: it.flow };
          jobs.push(job);
          it.start = chosen; it.end = chosen + it.minutes;
          it.window = win.name;
          it.startLabel = hhmm(chosen);
          it.endLabel = hhmm(chosen + it.minutes);
          placed.push(it);
        }
      });
    });

    const deferred = items.filter((i) => i.alloc > 0 && !i.start);
    deferred.forEach((i) => { i.status = "deferred"; i.alloc = 0; i.minutes = 0; i.window = null; });

    // 实际并发峰值（每 10 分钟采样）
    let peak = 0;
    items.filter((i) => i.start).forEach((it) => {
      for (let m = it.start; m < it.end; m += 10) {
        let load = 0;
        items.filter((j) => j.start && m >= j.start && m < j.end).forEach((j) => { load += j.flow; });
        peak = Math.max(peak, load);
      }
    });

    const totalAlloc = items.reduce((s, i) => s + i.alloc, 0);
    return {
      items,
      summary: {
        demand: totalDemand(list),
        quotaDaily: daily,
        quotaRemain: availableQuota(site).remain,
        allocated: totalAlloc,
        deferredVolume: items.reduce((s, i) => s + (i.status === "deferred" ? i.required - i.alloc : 0), 0),
        fullCount: items.filter((i) => i.status === "full").length,
        partialCount: items.filter((i) => i.status === "partial").length,
        deferredCount: items.filter((i) => i.status === "deferred").length,
        irrigationMinutes: items.reduce((s, i) => s + i.minutes, 0),
        peakFlow: peak
      }
    };
  }

  function hhmm(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** 7 日逐日需水（m³），按预报气象重算 */
  function dailyDemandForecast(site, todayWeather, cropKc) {
    const base = analyzeAll(site, todayWeather, cropKc);
    const out = [];
    const doy0 = site.doy;
    window.DATA.FORECAST.forEach((f, i) => {
      const E = et0(site, f, doy0 + i + 1);
      const m3 = base.reduce((s, p) => s + E.value * p.kc.total * p.area * MU_TO_M2 / 1000, 0);
      out.push({ label: f.label, rain: f.rain, et0: E.value, m3 });
    });
    return out;
  }

  /** 分区 7 日墒情预测 */
  function moistureSeries(p, site, weather, cropKc) {
    return forecastReserve(p, site, weather, cropKc);
  }

  function ledgerTotals(ledger) {
    const baseline = ledger.reduce((s, r) => s + r.baseline, 0);
    const actual = ledger.reduce((s, r) => s + r.actual, 0);
    return {
      baseline, actual,
      saved: baseline - actual,
      savingRate: baseline > 0 ? (baseline - actual) / baseline : 0,
      savedCost: (baseline - actual) * window.DATA.SITE.quota.waterPrice
    };
  }

  window.Engine = {
    et0, microFactor, effectiveKc, analyze, analyzeAll, totalDemand,
    availableQuota, buildPrescription, dailyDemandForecast, moistureSeries,
    moistureRatio, stressLevelFromRatio, ledgerTotals, hhmm, clamp
  };
})();
