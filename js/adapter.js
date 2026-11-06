/* 光下绿洲 · 数据接入适配层
 * 支持三种数据源：模拟(sim) / HTTP API(http) / 本地文件(file)
 * 统一接口：soil(), weather(), valves(), health()
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const CONFIG_KEY = "gxlv_data_source";
  const HTTP_BASE_KEY = "gxlv_http_base";

  let source = localStorage.getItem(CONFIG_KEY) || "sim";
  let httpBase = localStorage.getItem(HTTP_BASE_KEY) || "http://localhost:8080";
  let pollTimer = null;
  let listeners = [];

  const state = {
    source,
    httpBase,
    connected: source === "sim" ? true : false,
    lastSync: null,
    error: null
  };

  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  function setSource(s) {
    source = s;
    localStorage.setItem(CONFIG_KEY, s);
    state.source = s;
    state.connected = s === "sim";
    state.error = null;
    if (pollTimer) clearInterval(pollTimer);
    if (s === "http") startPolling();
    notify();
  }

  function setHttpBase(url) {
    httpBase = url;
    localStorage.setItem(HTTP_BASE_KEY, url);
    state.httpBase = url;
    notify();
  }

  async function fetchJson(path, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${httpBase}${path}`, { signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }

  async function checkConnection() {
    if (source !== "http") return true;
    try {
      await fetchJson("/api/health", 3000);
      state.connected = true;
      state.error = null;
    } catch (e) {
      state.connected = false;
      state.error = e.message;
    }
    notify();
    return state.connected;
  }

  function startPolling(interval = 10000) {
    checkConnection();
    pollTimer = setInterval(checkConnection, interval);
  }

  /* ---- 数据接口：统一返回 Promise ---- */

  async function soil() {
    if (source === "http") {
      try {
        const data = await fetchJson("/api/sensors/soil");
        state.lastSync = new Date();
        notify();
        return data;
      } catch (e) {
        state.error = e.message;
        notify();
        return fallbackSoil();
      }
    }
    return fallbackSoil();
  }

  async function weather() {
    if (source === "http") {
      try {
        const data = await fetchJson("/api/sensors/weather");
        state.lastSync = new Date();
        notify();
        return data;
      } catch (e) {
        return fallbackWeather();
      }
    }
    return fallbackWeather();
  }

  async function valves() {
    if (source === "http") {
      try {
        return await fetchJson("/api/sensors/valves");
      } catch (e) {
        return fallbackValves();
      }
    }
    return fallbackValves();
  }

  async function healthPatches() {
    if (source === "http") {
      try {
        return await fetchJson("/api/sensors/health");
      } catch (e) {
        return fallbackHealth();
      }
    }
    return fallbackHealth();
  }

  /* ---- 回退到模拟数据 ---- */
  function fallbackSoil() {
    return Promise.resolve(window.DATA.PARTITIONS.map((p) => ({
      nodeId: `SN-${p.id.slice(1)}`,
      partId: p.id,
      theta: p.theta,
      temp: 22 + Math.random() * 4,
      battery: 60 + Math.random() * 40,
      rssi: -60 - Math.random() * 20,
      ts: new Date().toISOString()
    })));
  }

  function fallbackWeather() {
    return Promise.resolve({ ...window.DATA.WEATHER, ts: new Date().toISOString() });
  }

  function fallbackValves() {
    return Promise.resolve(window.DATA.PARTITIONS.map((p) => ({
      valveId: p.valve,
      partId: p.id,
      status: "closed",
      flow: 0,
      todayVolume: 0,
      ts: new Date().toISOString()
    })));
  }

  function fallbackHealth() {
    return Promise.resolve(window.DATA.PATCHES);
  }

  /* ---- 文件导入 ---- */
  async function importFile(file) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 尝试 CSV
      const lines = text.trim().split(/\r?\n/);
      const headers = lines[0].split(",").map((h) => h.trim());
      data = lines.slice(1).map((line) => {
        const cells = line.split(",");
        const obj = {};
        headers.forEach((h, i) => { obj[h] = isNaN(cells[i]) ? cells[i] : Number(cells[i]); });
        return obj;
      });
    }
    return data;
  }

  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((f) => f !== fn); };
  }

  function getState() {
    return { ...state };
  }

  // 公网部署（如 GitHub Pages）时 localhost 接口不可达，强制回到模拟数据源
  if (source === "http" && location.protocol !== "file:" &&
      !["localhost", "127.0.0.1"].includes(location.hostname)) {
    source = "sim";
    localStorage.setItem(CONFIG_KEY, "sim");
    state.source = "sim";
    state.connected = true;
  }

  // 初始化时若上次选择为 HTTP 模式，立即启动健康检查轮询
  // （否则刷新页面后连接状态会卡在离线）
  if (source === "http") startPolling();

  window.DataAdapter = {
    setSource, setHttpBase, getState, onChange,
    soil, weather, valves, healthPatches, importFile,
    checkConnection
  };
})();
