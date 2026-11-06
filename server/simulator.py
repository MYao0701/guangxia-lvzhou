# -*- coding: utf-8 -*-
"""光下绿洲 · 传感器模拟器

模拟 42 个土壤墒情节点 + 1 个气象站 + 8 个电磁阀，
按固定周期向接收后端 POST 数据，用于演示真实数据流。

运行：python server/simulator.py  [base_url]  [interval_sec]
  默认 http://localhost:8080，每 5 秒推送一轮
"""
import json
import math
import os
import random
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
INTERVAL = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
API_KEY = os.environ.get("GXLV_TOKEN", "")

# 8 个分区基准含水率（与前端 data.js PARTITIONS 对齐）
PART_THETA = {
    "P1": 0.168, "P2": 0.168, "P3": 0.198, "P4": 0.078,
    "P5": 0.055, "P6": 0.078, "P7": 0.062, "P8": 0.122,
}
VALVES = [("V-0%d" % (i + 1), "P%d" % (i + 1)) for i in range(8)]

# 42 个节点分配到 8 个分区（P5 只有 2 个有效点位，对应"SN-07 离线"场景）
NODE_LAYOUT = {
    "P1": 6, "P2": 6, "P3": 6, "P4": 6, "P5": 2, "P6": 6, "P7": 5, "P8": 5,
}

random.seed(20270615)
NODES = []
_idx = 1
for pid, cnt in NODE_LAYOUT.items():
    for _ in range(cnt):
        NODES.append({
            "nodeId": "SN-%02d" % _idx,
            "partId": pid,
            "theta": PART_THETA[pid] + random.uniform(-0.006, 0.006),
            "online": random.random() > 0.05,  # ~5% 离线
        })
        _idx += 1

weather = {"tmax": 31.4, "tmin": 15.2, "rh": 32, "wind": 3.1, "rs": 26.8, "rain": 0.0}
tick = 0


def post(path, obj):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 **({"X-API-Key": API_KEY} if API_KEY else {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def push_soil():
    items = []
    for n in NODES:
        if not n["online"]:
            continue
        # 墒情缓慢下降（蒸散消耗）+ 噪声，下限 0.030
        n["theta"] = max(0.030, n["theta"] - random.uniform(0.0, 0.0006) + random.uniform(-0.0008, 0.0008))
        items.append({
            "nodeId": n["nodeId"],
            "partId": n["partId"],
            "theta": round(n["theta"], 4),
            "temp": round(22 + 6 * math.sin(tick / 30.0) + random.uniform(-1, 1), 1),
            "battery": round(random.uniform(58, 98), 0),
            "rssi": round(random.uniform(-82, -58), 0),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
    return post("/api/sensors/soil", items)


def push_weather():
    # 气象站读数围绕基准缓慢漂移
    weather["tmax"] = round(max(24, min(42, weather["tmax"] + random.uniform(-0.4, 0.4))), 1)
    weather["tmin"] = round(weather["tmax"] - random.uniform(13, 17), 1)
    weather["rh"] = round(max(15, min(70, weather["rh"] + random.uniform(-1.5, 1.5))), 0)
    weather["wind"] = round(max(0.5, min(7, weather["wind"] + random.uniform(-0.3, 0.3))), 1)
    weather["rs"] = round(max(15, min(30, weather["rs"] + random.uniform(-0.5, 0.5))), 1)
    weather["rain"] = 0.0
    weather["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    return post("/api/sensors/weather", dict(weather))


def push_valves():
    items = []
    for vid, pid in VALVES:
        items.append({
            "valveId": vid,
            "partId": pid,
            "status": "closed",
            "flow": 0,
            "todayVolume": round(random.uniform(0, 300), 0),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
    return post("/api/sensors/valves", items)


def main():
    global tick
    print("模拟器启动 → %s（每 %.0f 秒推送一轮，%d 个节点）" % (BASE, INTERVAL, len(NODES)))
    print("Ctrl+C 停止\n")
    # 启动前先推一轮阀门与气象
    try:
        push_weather()
        push_valves()
        push_soil()
        print("[%s] 首轮数据已推送" % time.strftime("%H:%M:%S"))
    except Exception as e:
        print("[!] 无法连接后端 %s：%s" % (BASE, e))
        print("    请先运行 python server/sensor_server.py")
        return
    while True:
        time.sleep(INTERVAL)
        tick += 1
        try:
            r1 = push_soil()
            push_weather()
            push_valves()
            print("[%s] 第 %d 轮：墒情 %s 条，气象/阀门已更新" % (
                time.strftime("%H:%M:%S"), tick, r1.get("accepted")))
        except Exception as e:
            print("[!] 推送失败：%s（后端可能已停止，继续重试）" % e)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n模拟器已停止")
