// 图表渲染：规模趋势图 + 业绩走势图（含最大回撤红色阴影标注），懒加载
const chartsData = {}; // code -> {scale:{labels,values}, nav:{labels,values,peakIdx,troughIdx}}
const _chartInited = {};

const mddShade = {
  id: 'mddShade',
  afterDatasetsDraw(chart) {
    if (chart.options.plugins && chart.options.plugins.mddShade && chart.options.plugins.mddShade.enabled === false) return;
    const data = chart.data;
    const p = data.peakIdx, t = data.troughIdx;
    if (p == null || t == null || p >= t) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || meta.data.length < 2) return;
    const ctx = chart.ctx;
    const p1 = meta.data[p], p2 = meta.data[t];
    if (!p1 || !p2) return;
    const top = chart.chartArea.top, h = chart.chartArea.height;
    ctx.save();
    ctx.fillStyle = 'rgba(220,38,38,0.10)';
    ctx.fillRect(p1.x, top, p2.x - p1.x, h);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(220,38,38,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p1.x, top); ctx.lineTo(p1.x, top + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p2.x, top); ctx.lineTo(p2.x, top + h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#dc2626'; ctx.fill();
    ctx.beginPath(); ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#16a34a'; ctx.fill();
    // 图上文字标注：最大回撤区间
    const label = data.mddLabel || '最大回撤区间';
    ctx.fillStyle = 'rgba(220,38,38,.9)';
    ctx.font = 'bold 10px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    const labelY = Math.max(top + 12, p1.y - 10);
    ctx.fillText('▼ ' + label, p1.x + 6, labelY);
    ctx.restore();
  }
};

function chartBase(data, color) {
  return {
    type: 'line',
    data,
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  };
}

function initChart(id) {
  if (_chartInited[id]) return;
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  const cfg = chartsData[id];
  if (!cfg) return;
  new Chart(canvas, cfg);
  _chartInited[id] = true;
}

function toggleCard(btn) {
  const detail = btn.nextElementSibling;
  const open = detail.classList.toggle('open');
  btn.classList.toggle('open', open);
  if (open) {
    const cs = detail.querySelectorAll('canvas');
    for (let i = 0; i < cs.length; i++) initChart(cs[i].id);
  }
}

// 注册卡片数据到 chartsData，并渲染卡片时调用
function registerCharts(d) {
  const code = d.code;
  const st = d.scaleTrend || [];
  if (st.length > 1) {
    chartsData['c_' + code] = chartBase({
      labels: st.map(s => s.date),
      datasets: [{
        label: '净资产（亿元）', data: st.map(s => s.value),
        borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.08)',
        fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: '#4f46e5'
      }]
    });
  }
  const nv = d.navTrend || [];
  if (nv.length > 5) {
    // 业绩图：全历史净值，直接使用后端返回的峰值/谷底索引标注历史最大回撤
    const labels = nv.map(s => { const dd = new Date(s.x); return (dd.getMonth() + 1) + '/' + dd.getDate(); });
    const values = nv.map(s => s.y);
    const rm = d.riskMetrics || {};
    let peakIdx = null, troughIdx = null;
    if (rm.peakIdx != null && rm.troughIdx != null && rm.peakIdx < rm.troughIdx && rm.troughIdx < nv.length) {
      peakIdx = rm.peakIdx; troughIdx = rm.troughIdx;
    }
    const mddL = rm.maxDrawdown ? '最大回撤 ' + Math.abs(parseFloat(rm.maxDrawdown)).toFixed(1) + '%' : '最大回撤区间';
    chartsData['nav_' + code] = chartBase({
      labels, peakIdx, troughIdx, mddLabel: mddL,
      datasets: [{
        label: '单位净值', data: values, borderColor: '#4f46e5',
        backgroundColor: 'rgba(79,70,229,.06)', fill: true, tension: .25,
        pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#4f46e5'
      }]
    });
    chartsData['nav_' + code].plugins = ['mddShade'];
  }
}

if (typeof Chart !== 'undefined') Chart.register(mddShade);
