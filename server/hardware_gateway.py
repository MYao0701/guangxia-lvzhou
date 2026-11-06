# -*- coding: utf-8 -*-
"""光下绿洲 · 田间网关上报程序（真实硬件接入参考实现）

部署在田间网关（树莓派 / 边缘盒子 / 工控机）上，定时采集传感器数据并
POST 到接收后端。核心特性：
  - 断网时数据缓存在本地 gateway_cache.jsonl，恢复后自动补传
    （对应方案中"断网连续运行 7 天"的边缘能力）
  - 只需在 nodes.json 登记设备号 → 分区映射，上报时无需关心分区

接入步骤：
  1. 按你的硬件实现下面的 read_soil_nodes() / read_weather_station()
     （常见三种方式见函数内注释：RS485/Modbus RTU、LoRaWAN+MQTT、厂商 SDK）
  2. 配置服务端地址与密钥（环境变量或直接改下面常量）：
       setx GXLV_SERVER "http://你的服务器IP:8080"
       setx GXLV_TOKEN  "与服务端一致的密钥"
  3. 运行：python hardware_gateway.py

Windows 计划任务 / Linux systemd 均可做开机自启与守护。
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.environ.get("GXLV_SERVER", "http://localhost:8080")
API_KEY = os.environ.get("GXLV_TOKEN", "")
INTERVAL = int(os.environ.get("GXLV_INTERVAL", "60"))  # 采集周期（秒）
CACHE_FILE = os.path.join(HERE, "gateway_cache.jsonl")


# ============================================================
# 1. 传感器采集 —— 按实际硬件实现以下函数
# ============================================================

def read_soil_nodes():
    """读取全部土壤墒情节点，返回列表：
    [{"nodeId": "设备号", "theta": 体积含水率(0-1), "temp": 土温, "battery": 电量, "rssi": 信号}, ...]

    方式 A：RS485 / Modbus RTU（土壤温湿度传感器最常见）
        pip install pymodbus pyserial
        ------------------------------------------------------------
        from pymodbus.client import ModbusSerialClient
        client = ModbusSerialClient(port="COM3", baudrate=9600)  # Linux: /dev/ttyUSB0
        client.connect()
        results = []
        for addr in NODE_ADDRESSES:              # 每个节点的站号
            rr = client.read_holding_registers(0, 2, slave=addr)
            theta = rr.registers[0] / 1000.0     # 按传感器手册换算
            temp  = rr.registers[1] / 10.0
            results.append({"nodeId": "NODE-%02d" % addr, "theta": theta, "temp": temp})
        client.close()
        return results
        ------------------------------------------------------------

    方式 B：LoRaWAN（ChirpStack / TTN）
        在 ChirpStack 配置 HTTP Integration 直接 POST 到本服务端
        /api/sensors/soil（带 X-API-Key），可跳过本脚本；
        或用 paho-mqtt 订阅 application/+/device/+/event/up 后在此转发。

    方式 C：厂商 SDK / 串口自定义协议
        按厂商文档解析后组装成上述字典即可。
    """
    raise NotImplementedError("请按实际硬件实现 read_soil_nodes()，见函数注释")


def read_weather_station():
    """读取气象站，返回：
    {"tmax": ℃, "tmin": ℃, "rh": %, "wind": m/s, "rs": MJ/m², "rain": mm}
    小型气象站同样多走 RS485/Modbus，参考 read_soil_nodes() 方式 A。
    """
    return None  # 可选：没有气象站时返回 None


# ============================================================
# 2. 上报与断网缓存（一般无需改动）
# ============================================================

def _post(path, obj):
    req = urllib.request.Request(
        SERVER + path,
        data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 **({"X-API-Key": API_KEY} if API_KEY else {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _cache(path, obj):
    with open(CACHE_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps({"path": path, "data": obj}, ensure_ascii=False) + "\n")


def flush_cache():
    """补传缓存：成功全部发送后清空缓存文件。"""
    if not os.path.exists(CACHE_FILE):
        return 0
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        lines = [l for l in f.read().splitlines() if l.strip()]
    sent = 0
    for i, line in enumerate(lines):
        try:
            item = json.loads(line)
            _post(item["path"], item["data"])
            sent += 1
        except Exception:
            # 保留未发送部分，等待下一轮
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(lines[i:]) + "\n")
            return sent
    os.remove(CACHE_FILE)
    return sent


def send(path, obj):
    """发送失败时写入本地缓存。"""
    try:
        return _post(path, obj)
    except Exception as e:
        _cache(path, obj)
        print("[缓存] %s（%s）" % (path, e))
        return None


def main():
    print("光下绿洲 · 田间网关")
    print("服务端: %s | 周期: %ds | 鉴权: %s" % (SERVER, INTERVAL, "启用" if API_KEY else "关闭"))
    while True:
        t0 = time.time()
        n = flush_cache()
        if n:
            print("[补传] 已补传 %d 条缓存数据" % n)
        try:
            nodes = read_soil_nodes()
            if nodes:
                r = send("/api/sensors/soil", nodes)
                if r:
                    print("[%s] 墒情 %d 条已上报" % (time.strftime("%H:%M:%S"), r.get("accepted", 0)))
        except NotImplementedError as e:
            print("[!] %s" % e)
            sys.exit(2)
        except Exception as e:
            print("[!] 采集失败：%s" % e)
        w = read_weather_station()
        if w:
            send("/api/sensors/weather", w)
        time.sleep(max(1, INTERVAL - (time.time() - t0)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n网关已停止")
