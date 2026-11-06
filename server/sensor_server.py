# -*- coding: utf-8 -*-
"""光下绿洲 · 传感器数据接收后端（零依赖，Python 标准库）

真实硬件接入说明：
  1. 节点注册表 nodes.json：真实设备号（MAC/序列号）→ 分区映射，
     网关上报时无需知道分区，由服务端按 nodeId 自动解析 partId。
  2. 鉴权：设置环境变量 GXLV_TOKEN 后，所有 POST 请求必须携带
     请求头 X-API-Key: <token>；不设置则不鉴权（本地调试模式）。
  3. 数据校验：theta 必须在 [0, 1] 区间，非法记录拒收并在响应中计数。

接口契约（与 js/adapter.js 对应）：
  GET  /api/health            心跳 {ok, ts, uptime, counts}
  GET  /api/nodes             节点注册表与在线状态
  GET  /api/sensors/soil      全部墒情节点最新读数（数组）
  POST /api/sensors/soil      推送墒情（单条对象或数组）
  GET  /api/sensors/weather   气象站最新读数（对象）
  POST /api/sensors/weather   推送气象（对象）
  GET  /api/sensors/valves    全部阀门最新状态（数组）
  POST /api/sensors/valves    推送阀门（单条对象或数组）
  GET  /api/sensors/health    健康斑块数据（数组）
  POST /api/sensors/health    推送健康斑块（数组）

数据格式：
  soil:    {nodeId, partId(可选，由注册表解析), theta, temp, battery, rssi, ts}
  weather: {tmax, tmin, rh, wind, rs, rain, ts}
  valves:  {valveId, partId(可选), status, flow, todayVolume, ts}

运行：python server/sensor_server.py  [port]
"""
import json
import os
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.dirname(HERE)  # 项目根目录，作为网站文档根
TOKEN = os.environ.get("GXLV_TOKEN", "")  # 设置后启用 POST 鉴权

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
}

STORE = {
    "soil": {},      # nodeId -> record
    "weather": None,  # latest record
    "valves": {},     # valveId -> record
    "health": [],     # list of patches
}
LOCK = threading.Lock()
START = time.time()


def _load_registry():
    path = os.path.join(HERE, "nodes.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("nodes", {})
    except FileNotFoundError:
        return {}


REGISTRY = _load_registry()  # nodeId -> {partId, depthCm, note}


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _validate_soil(r):
    """校验并规范化一条墒情记录；返回 (record, error)。"""
    nid = r.get("nodeId")
    if not nid or not isinstance(nid, str):
        return None, "missing nodeId"
    theta = _to_float(r.get("theta"))
    if theta is None or not (0.0 <= theta <= 1.0):
        return None, "theta out of range [0,1]"
    rec = {"nodeId": nid, "theta": round(theta, 4)}
    # partId：上报值优先，缺失时由注册表解析
    pid = r.get("partId") or (REGISTRY.get(nid) or {}).get("partId")
    if pid:
        rec["partId"] = pid
    for k in ("temp", "battery", "rssi"):
        v = _to_float(r.get(k))
        if v is not None:
            rec[k] = v
    rec["ts"] = r.get("ts") or _now()
    return rec, None


def _validate_weather(r):
    rec = {}
    for k in ("tmax", "tmin", "rh", "wind", "rs", "rain"):
        v = _to_float(r.get(k))
        if v is not None:
            rec[k] = v
    if "tmax" not in rec:
        return None, "missing tmax"
    rec["ts"] = r.get("ts") or _now()
    return rec, None


def _validate_valve(r):
    vid = r.get("valveId")
    if not vid:
        return None, "missing valveId"
    rec = {"valveId": vid, "status": r.get("status") or "closed"}
    pid = r.get("partId") or (REGISTRY.get(vid) or {}).get("partId")
    if pid:
        rec["partId"] = pid
    for k in ("flow", "todayVolume"):
        v = _to_float(r.get(k))
        if v is not None:
            rec[k] = v
    rec["ts"] = r.get("ts") or _now()
    return rec, None


class Handler(BaseHTTPRequestHandler):
    server_version = "GXLV-SensorServer/2.0"

    # ---------- 工具 ----------
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _auth_ok(self):
        if not TOKEN:
            return True  # 未设置 GXLV_TOKEN，本地调试模式
        return self.headers.get("X-API-Key") == TOKEN

    def log_message(self, fmt, *args):  # 简洁日志
        sys.stderr.write("[%s] %s\n" % (_now(), fmt % args))

    # ---------- CORS 预检 ----------
    def do_OPTIONS(self):
        self._send(204, {})

    # ---------- 静态网站 ----------
    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        # 防路径穿越
        rel = os.path.normpath(path.lstrip("/"))
        full = os.path.join(WEB_ROOT, rel)
        if not os.path.abspath(full).startswith(os.path.abspath(WEB_ROOT)):
            return self._send(403, {"error": "forbidden"})
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, {"error": "not found", "path": path})
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, {"error": "not found", "path": path})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---------- GET ----------
    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if not path.startswith("/api"):
            return self._serve_static(self.path.split("?")[0])
        with LOCK:
            if path == "/api/health":
                return self._send(200, {
                    "ok": True,
                    "ts": _now(),
                    "uptime": round(time.time() - START, 1),
                    "auth": bool(TOKEN),
                    "counts": {
                        "soilNodes": len(STORE["soil"]),
                        "valves": len(STORE["valves"]),
                        "healthPatches": len(STORE["health"]),
                        "hasWeather": STORE["weather"] is not None,
                        "registeredNodes": len(REGISTRY),
                    },
                })
            if path == "/api/nodes":
                nodes = []
                for nid, meta in REGISTRY.items():
                    live = STORE["soil"].get(nid)
                    nodes.append({
                        "nodeId": nid,
                        "partId": meta.get("partId"),
                        "depthCm": meta.get("depthCm"),
                        "note": meta.get("note"),
                        "online": live is not None,
                        "lastTs": live.get("ts") if live else None,
                    })
                # 已上报但未注册的设备（待登记）
                unmapped = [nid for nid in STORE["soil"] if nid not in REGISTRY]
                return self._send(200, {"registered": nodes, "unmapped": unmapped})
            if path == "/api/sensors/soil":
                return self._send(200, list(STORE["soil"].values()))
            if path == "/api/sensors/weather":
                if STORE["weather"] is None:
                    return self._send(404, {"error": "no weather data yet"})
                return self._send(200, STORE["weather"])
            if path == "/api/sensors/valves":
                return self._send(200, list(STORE["valves"].values()))
            if path == "/api/sensors/health":
                return self._send(200, STORE["health"])
        return self._send(404, {"error": "not found", "path": path})

    # ---------- POST ----------
    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path.startswith("/api/") and not self._auth_ok():
            return self._send(401, {"error": "unauthorized: X-API-Key required"})
        try:
            payload = self._read_json()
        except Exception as e:
            return self._send(400, {"error": "invalid json", "detail": str(e)})
        if payload is None:
            return self._send(400, {"error": "empty body"})

        with LOCK:
            if path == "/api/sensors/soil":
                items = payload if isinstance(payload, list) else [payload]
                ok, errors = 0, []
                for r in items:
                    rec, err = _validate_soil(r)
                    if err:
                        errors.append({"nodeId": r.get("nodeId"), "error": err})
                        continue
                    STORE["soil"][rec["nodeId"]] = rec
                    ok += 1
                resp = {"ok": True, "accepted": ok, "total": len(STORE["soil"])}
                if errors:
                    resp["rejected"] = errors
                return self._send(200, resp)

            if path == "/api/sensors/weather":
                rec, err = _validate_weather(payload)
                if err:
                    return self._send(400, {"error": err})
                STORE["weather"] = rec
                return self._send(200, {"ok": True})

            if path == "/api/sensors/valves":
                items = payload if isinstance(payload, list) else [payload]
                ok, errors = 0, []
                for r in items:
                    rec, err = _validate_valve(r)
                    if err:
                        errors.append({"valveId": r.get("valveId"), "error": err})
                        continue
                    STORE["valves"][rec["valveId"]] = rec
                    ok += 1
                resp = {"ok": True, "accepted": ok, "total": len(STORE["valves"])}
                if errors:
                    resp["rejected"] = errors
                return self._send(200, resp)

            if path == "/api/sensors/health":
                items = payload if isinstance(payload, list) else [payload]
                STORE["health"] = items
                return self._send(200, {"ok": True, "total": len(items)})

        return self._send(404, {"error": "not found", "path": path})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("=" * 56)
    print("  光下绿洲 · 一体化网站 v2.1（前端 + 数据接口）")
    print("  桌面版:  http://localhost:%d/" % port)
    print("  移动版:  http://localhost:%d/mobile/" % port)
    print("  接口:    http://localhost:%d/api/health" % port)
    print("  鉴权: %s" % ("已启用（X-API-Key）" if TOKEN else "未启用（设置 GXLV_TOKEN 开启）"))
    print("  注册节点: %d 个" % len(REGISTRY))
    print("=" * 56)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
