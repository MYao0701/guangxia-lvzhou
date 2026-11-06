/* 轻量 Canvas 图表：折线 / 柱状，无外部依赖 */
(function () {
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(280, canvas.clientWidth || canvas.parentElement.clientWidth || 600);
    const cssH = parseFloat(canvas.getAttribute("height")) || 250;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: cssW, H: cssH };
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function fmtNum(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + "万";
    if (v >= 1000) return Math.round(v).toLocaleString("zh-CN");
    return v.toFixed(v < 10 ? 1 : 0);
  }

  function lineChart(canvas, cfg) {
    const { ctx, W, H } = prep(canvas);
    const pad = { l: 52, r: 16, t: 16, b: 30 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const labels = cfg.labels || [];
    const n = labels.length;
    const all = cfg.series.flatMap((s) => s.data).concat((cfg.thresholds || []).map((t) => t.value));
    const maxVal = cfg.yMax || niceMax(Math.max(...all) * 1.12);
    const minVal = cfg.yMin !== undefined ? cfg.yMin : 0;
    const x = (i) => pad.l + (n <= 1 ? 0 : (iw * i) / (n - 1));
    const y = (v) => pad.t + ih - ((v - minVal) / (maxVal - minVal)) * ih;

    let hover = null;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // 网格与 Y 轴
      ctx.font = '10px "SFMono-Regular",Consolas,monospace';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 4; g++) {
        const v = minVal + ((maxVal - minVal) / 4) * g;
        const yy = y(v);
        ctx.strokeStyle = "rgba(255,255,255,.055)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.l, yy);
        ctx.lineTo(W - pad.r, yy);
        ctx.stroke();
        ctx.fillStyle = "#55696d";
        ctx.fillText(fmtNum(v), pad.l - 9, yy);
      }
      // 阈值线
      (cfg.thresholds || []).forEach((t) => {
        const yy = y(t.value);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = t.color || "#ef6b63";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.l, yy);
        ctx.lineTo(W - pad.r, yy);
        ctx.stroke();
        ctx.restore();
        if (t.label) {
          ctx.fillStyle = t.color || "#ef6b63";
          ctx.font = '9.5px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.textAlign = "left";
          ctx.fillText(t.label, pad.l + 4, yy - 7);
        }
      });
      // X 轴标签
      ctx.fillStyle = "#55696d";
      ctx.font = '10px "SFMono-Regular",Consolas,monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      labels.forEach((l, i) => {
        if (n <= 8 || i % 2 === 0) ctx.fillText(l, x(i), H - pad.b + 8);
      });
      // 系列
      cfg.series.forEach((s) => {
        if (s.area !== false) {
          const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
          grad.addColorStop(0, hexA(s.color, 0.22));
          grad.addColorStop(1, hexA(s.color, 0.01));
          ctx.beginPath();
          s.data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
          ctx.lineTo(x(n - 1), pad.t + ih);
          ctx.lineTo(x(0), pad.t + ih);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width || 2;
        ctx.lineJoin = "round";
        if (s.dashed) ctx.setLineDash([5, 4]);
        s.data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
        ctx.stroke();
        ctx.setLineDash([]);
        s.data.forEach((v, i) => {
          ctx.fillStyle = "#0c1618";
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      });
      // hover
      if (hover !== null) {
        const hx = x(hover);
        ctx.strokeStyle = "rgba(242,176,75,.35)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, pad.t);
        ctx.lineTo(hx, pad.t + ih);
        ctx.stroke();
        ctx.setLineDash([]);
        let ty = pad.t + 4;
        const boxW = 118, boxH = cfg.series.length * 16 + 24;
        let bx = Math.min(hx + 10, W - pad.r - boxW);
        if (bx < pad.l) bx = pad.l;
        ctx.fillStyle = "rgba(10,20,22,.95)";
        ctx.strokeStyle = "#2c464a";
        ctx.lineWidth = 1;
        roundRect(ctx, bx, ty, boxW, boxH, 7);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#8fa4a7";
        ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText(labels[hover], bx + 10, ty + 7);
        cfg.series.forEach((s, si) => {
          const vv = s.data[hover];
          ctx.fillStyle = s.color;
          ctx.fillRect(bx + 10, ty + 25 + si * 16, 6, 2.5);
          ctx.fillStyle = "#dbe7e6";
          ctx.font = '10px "SFMono-Regular",Consolas,monospace';
          ctx.fillText(`${fmtNum(vv)}${cfg.yUnit || ""}`, bx + 22, ty + 21 + si * 16);
        });
      }
    }

    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx < pad.l - 8 || mx > W - pad.r + 8) { hover = null; draw(); return; }
      const idx = Math.round(((mx - pad.l) / iw) * (n - 1));
      hover = Math.max(0, Math.min(n - 1, idx));
      draw();
    }
    canvas.onmousemove = onMove;
    canvas.onmouseleave = () => { hover = null; draw(); };
    draw();
    return { redraw: draw };
  }

  function barChart(canvas, cfg) {
    const { ctx, W, H } = prep(canvas);
    const pad = { l: 52, r: 14, t: 14, b: 30 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const n = cfg.labels.length;
    const series = cfg.series;
    const maxVal = niceMax(Math.max(...series.flatMap((s) => s.data)) * 1.1);
    const groupW = iw / n;
    const barW = Math.min(18, (groupW * 0.62) / series.length);

    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px "SFMono-Regular",Consolas,monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g++) {
      const v = (maxVal / 4) * g;
      const yy = pad.t + ih - (v / maxVal) * ih;
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(W - pad.r, yy);
      ctx.stroke();
      ctx.fillStyle = "#55696d";
      ctx.fillText(fmtNum(v), pad.l - 9, yy);
    }
    cfg.labels.forEach((l, i) => {
      const cx = pad.l + groupW * i + groupW / 2;
      series.forEach((s, si) => {
        const v = s.data[i];
        const bh = (v / maxVal) * ih;
        const bx = cx - (barW * series.length) / 2 + si * barW;
        const grd = ctx.createLinearGradient(0, pad.t + ih - bh, 0, pad.t + ih);
        grd.addColorStop(0, s.color);
        grd.addColorStop(1, hexA(s.color, 0.35));
        ctx.fillStyle = grd;
        roundRect(ctx, bx, pad.t + ih - bh, barW - 2, bh, 2.5);
        ctx.fill();
      });
      ctx.fillStyle = "#55696d";
      ctx.font = '9.5px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(l, cx, H - pad.b + 8);
    });
    return { redraw: () => barChart(canvas, cfg) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  window.Charts = { lineChart, barChart, fmtNum, hexA };
})();
