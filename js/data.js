/* 光下绿洲 · 演示数据（仿真）
 * 说明：气象、墒情、无人机栅格为内置仿真数据；所有指标由 engine.js 按真实公式计算。
 */
(function () {
  const SITE = {
    id: "wuwei-liangzhou",
    name: "武威 · 凉州光伏治沙基地",
    shortName: "凉州基地",
    areaMu: 10000,
    lat: 37.93,
    elev: 1531,
    scenarioTime: "2027-06-15 08:30",
    doy: 166,
    panels: { rowSpacing: 6.0, height: 1.6, orientation: "东西向", tilt: 28, shadeRatio: 0.38, coverRatio: 0.62 },
    quota: {
      yearly: 2500000,
      monthName: "6 月",
      monthQuota: 430000,
      monthUsed: 220000,
      daysLeft: 15,
      waterPrice: 0.35
    },
    source: { maxFlow: 6500, note: "滴灌管网水源能力 6,500 m³/h" },
    windows: [
      { id: "w1", name: "05:00 – 10:00", start: 5, end: 10, minutes: 300 },
      { id: "w2", name: "18:00 – 23:00", start: 18, end: 23, minutes: 300 }
    ]
  };

  const WEATHER = {
    tmax: 31.4,
    tmin: 15.2,
    rh: 32,
    wind: 3.1,
    rs: 26.8,
    rain: 0.0
  };

  const FORECAST = [
    { label: "6/16", tmax: 32.6, tmin: 16.1, rh: 30, wind: 3.6, rs: 27.4, rain: 0.0 },
    { label: "6/17", tmax: 30.2, tmin: 15.6, rh: 44, wind: 2.8, rs: 24.1, rain: 2.4 },
    { label: "6/18", tmax: 28.4, tmin: 14.8, rh: 48, wind: 2.2, rs: 21.6, rain: 0.8 },
    { label: "6/19", tmax: 31.8, tmin: 16.4, rh: 34, wind: 3.2, rs: 26.9, rain: 0.0 },
    { label: "6/20", tmax: 34.2, tmin: 18.1, rh: 26, wind: 4.1, rs: 28.6, rain: 0.0 },
    { label: "6/21", tmax: 33.1, tmin: 19.2, rh: 30, wind: 3.4, rs: 27.8, rain: 0.0 },
    { label: "6/22", tmax: 29.6, tmin: 17.8, rh: 52, wind: 2.6, rs: 20.4, rain: 6.0 }
  ];

  // 分区：micro = under(板下) / between(板间) / edge(板缘)
  // theta 为当前体积含水率；fc 为田持；wp 为凋萎点；cover 为植被覆盖度
  const PARTITIONS = [
    { id: "P1", name: "板下·东区", micro: "under", seedAge: 62, area: 1500, crop: "牧草", soil: "砂壤土", cover: 0.62, rootDepth: 0.55, fc: 0.240, wp: 0.080, theta: 0.168, valve: "V-01", flow: 2600, color: "#5fd48a" },
    { id: "P2", name: "板下·中区", micro: "under", seedAge: 58, area: 1300, crop: "牧草", soil: "砂壤土", cover: 0.58, rootDepth: 0.55, fc: 0.240, wp: 0.080, theta: 0.168, valve: "V-02", flow: 2300, color: "#48c17c" },
    { id: "P3", name: "板下·西区", micro: "under", seedAge: 70, area: 1400, crop: "药材", soil: "壤土", cover: 0.50, rootDepth: 0.60, fc: 0.280, wp: 0.110, theta: 0.198, valve: "V-03", flow: 2400, color: "#37ad6e" },
    { id: "P4", name: "板间·东段", micro: "between", seedAge: 55, area: 1200, crop: "牧草", soil: "风沙土", cover: 0.48, rootDepth: 0.50, fc: 0.140, wp: 0.040, theta: 0.078, valve: "V-04", flow: 2100, color: "#f2b04b" },
    { id: "P5", name: "板间·中段", micro: "between", seedAge: 48, area: 1300, crop: "牧草", soil: "风沙土", cover: 0.46, rootDepth: 0.50, fc: 0.140, wp: 0.040, theta: 0.055, valve: "V-05", flow: 2300, color: "#e39a34" },
    { id: "P6", name: "板间·西段", micro: "between", seedAge: 52, area: 1200, crop: "沙生植物", soil: "风沙土", cover: 0.40, rootDepth: 0.45, fc: 0.130, wp: 0.035, theta: 0.078, valve: "V-06", flow: 2100, color: "#c98427" },
    { id: "P7", name: "板缘·北带", micro: "edge", seedAge: 40, area: 1100, crop: "沙生植物", soil: "风沙土", cover: 0.38, rootDepth: 0.45, fc: 0.130, wp: 0.035, theta: 0.062, valve: "V-07", flow: 1900, color: "#45c8d6" },
    { id: "P8", name: "板缘·南带", micro: "edge", seedAge: 45, area: 1000, crop: "沙生植物", soil: "砂壤土", cover: 0.42, rootDepth: 0.45, fc: 0.200, wp: 0.060, theta: 0.122, valve: "V-08", flow: 1700, color: "#2fa9b8" }
  ];

  const CROP_KC = { "牧草": 0.92, "药材": 0.88, "沙生植物": 0.55 };
  const STAGE = { name: "生长中期", stageFactor: 1.0 };

  // 无人机异常斑块（相对分区坐标 0-1）
  const PATCHES = [
    { id: "SP-01", part: "P5", x: 0.32, y: 0.55, r: 0.27, type: "重度缺水", level: 3, areaMu: 186, ndvi: 0.21, ndre: 0.09, cwsi: 0.86 },
    { id: "SP-02", part: "P7", x: 0.68, y: 0.40, r: 0.23, type: "重度缺水", level: 3, areaMu: 142, ndvi: 0.24, ndre: 0.11, cwsi: 0.82 },
    { id: "SP-03", part: "P4", x: 0.30, y: 0.35, r: 0.20, type: "中度缺水", level: 2, areaMu: 96, ndvi: 0.33, ndre: 0.16, cwsi: 0.68 },
    { id: "SP-04", part: "P6", x: 0.62, y: 0.62, r: 0.17, type: "中度缺水", level: 2, areaMu: 74, ndvi: 0.36, ndre: 0.18, cwsi: 0.64 },
    { id: "SP-05", part: "P2", x: 0.45, y: 0.42, r: 0.12, type: "死亡斑块", level: 3, areaMu: 28, ndvi: 0.11, ndre: 0.04, cwsi: 0.95 },
    { id: "SP-06", part: "P3", x: 0.70, y: 0.30, r: 0.14, type: "病虫害", level: 2, areaMu: 41, ndvi: 0.42, ndre: 0.12, cwsi: 0.38 },
    { id: "SP-07", part: "P8", x: 0.35, y: 0.58, r: 0.13, type: "轻度缺水", level: 1, areaMu: 52, ndvi: 0.45, ndre: 0.24, cwsi: 0.52 }
  ];

  const INSPECTION = {
    date: "2027-06-14 09:20",
    sorties: 6,
    flight: "1 小时 52 分",
    render: "3 小时 40 分",
    areaMu: 10000,
    images: 1842,
    resolution: "5.2 cm",
    layers: "多光谱 5 波段 + 热红外"
  };

  // 分旬水账（m³）——本生长季累计
  const LEDGER = [
    { period: "4 月上旬", baseline: 148000, actual: 107600, rain: 8.2 },
    { period: "4 月中旬", baseline: 156000, actual: 113400, rain: 5.6 },
    { period: "4 月下旬", baseline: 163000, actual: 118500, rain: 12.4 },
    { period: "5 月上旬", baseline: 172000, actual: 125000, rain: 3.1 },
    { period: "5 月中旬", baseline: 168000, actual: 122100, rain: 6.8 },
    { period: "5 月下旬", baseline: 176000, actual: 127900, rain: 2.2 },
    { period: "6 月上旬", baseline: 181000, actual: 131600, rain: 1.4 },
    { period: "6 月中旬", baseline: 96000, actual: 69800, rain: 0.0 }
  ];

  const CONTROL_PLOT = { areaMu: 500, baseline: 64000, actual: 44800, ndviBase: 0.38, ndviRx: 0.43, yieldBase: 100, yieldRx: 112.6 };

  const DEVICES = [
    { key: "nodes", name: "墒情节点", total: 42, online: 38, note: "10 / 20 / 40 cm 三层", accent: "#45c8d6" },
    { key: "valves", name: "电动阀", total: 8, online: 8, note: "板下板间分区控制", accent: "#5fd48a" },
    { key: "edge", name: "边缘盒子", total: 2, online: 2, note: "本地推理与缓存", accent: "#f2b04b" },
    { key: "weather", name: "气象站", total: 1, online: 1, note: "辐照 / 温湿度 / 风速", accent: "#a78bfa" },
    { key: "flow", name: "流量计", total: 8, online: 8, note: "分区进水计量", accent: "#45c8d6" },
    { key: "drone", name: "无人机", total: 1, online: 1, note: "多光谱 + 热红外", accent: "#5fd48a" }
  ];

  const OFFLINE_NODES = [
    { node: "SN-07", part: "P5 板间·中段", depth: "20 cm", since: "18 小时", cause: "风沙掩埋" },
    { node: "SN-19", part: "P7 板缘·北带", depth: "40 cm", since: "6 小时", cause: "牲畜踩踏" },
    { node: "SN-31", part: "P4 板间·东段", depth: "10 cm", since: "24 小时", cause: "信号弱" },
    { node: "SN-42", part: "P2 板下·中区", depth: "40 cm", since: "2 小时", cause: "电池低电量" }
  ];

  const INTEGRATIONS = [
    { name: "水肥一体化控制器", protocol: "Modbus TCP", status: "已接入", ok: true },
    { name: "基地 SCADA 系统", protocol: "OPC UA（只读）", status: "已接入", ok: true },
    { name: "基地气象站", protocol: "HTTP API / 10 min", status: "已接入", ok: true },
    { name: "值班室大屏与手机推送", protocol: "WebSocket + 短信", status: "已接入", ok: true },
    { name: "集团节能节水台账", protocol: "Excel / 月报导出", status: "已启用", ok: true }
  ];

  const EDGE_BOX = {
    uptime: "运行 46 天 12 小时",
    offlineRun: "断网连续运行 7 天 4 小时",
    cache: "缓存 12,480 条",
    latency: "0.6 秒 / 幅",
    model: "重参数化 U-Net INT8 · ET₀ 规则引擎",
    cpu: "38%",
    disk: "61%",
    lastSync: "08:22 已同步"
  };

  // 栅格地图布局（canvas 980 x 470）
  const MAP_LAYOUT = [
    { id: "P1", x: 46, y: 66, w: 205, h: 155 },
    { id: "P2", x: 278, y: 66, w: 190, h: 155 },
    { id: "P3", x: 495, y: 66, w: 195, h: 155 },
    { id: "P4", x: 717, y: 66, w: 205, h: 155 },
    { id: "P7", x: 46, y: 268, w: 205, h: 148 },
    { id: "P5", x: 278, y: 268, w: 190, h: 148 },
    { id: "P6", x: 495, y: 268, w: 195, h: 148 },
    { id: "P8", x: 717, y: 268, w: 205, h: 148 }
  ];

  window.DATA = {
    SITE, WEATHER, FORECAST, PARTITIONS, CROP_KC, STAGE, PATCHES, INSPECTION,
    LEDGER, CONTROL_PLOT, DEVICES, OFFLINE_NODES, INTEGRATIONS, EDGE_BOX, MAP_LAYOUT
  };
})();
