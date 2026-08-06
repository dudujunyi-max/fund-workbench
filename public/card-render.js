// 卡片渲染：renderOverview（组合总览）+ renderCard（单基金卡片），样式与「重点基金配置建议」一致
const CATS = {
  '权益类': ['股票', '偏股', '灵活配置', '混合型-灵活', '混合型-偏股', '混合', '港股'],
  '固收类': ['债', '货币', '理财'],
  '商品类': ['商品', '期货', '黄金', '原油'],
  'FOF类': ['FOF', '养老'],
};
function classify(t) {
  t = t || '';
  for (const [cat, kws] of Object.entries(CATS)) {
    if (kws.some(k => t.includes(k))) return cat;
  }
  return '其他';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 组合总览
function renderOverview(funds) {
  const n = funds.length;
  const catCnt = { '权益类': 0, '固收类': 0, '商品类': 0, 'FOF类': 0, '其他': 0 };
  const posCnt = { '核心配置': 0, '卫星配置': 0, '机会型配置': 0 };
  funds.forEach(f => {
    catCnt[classify(f.type)]++;
    posCnt[(f.report && f.report.position && f.report.position.label) || '机会型配置']++;
  });
  const eq = catCnt['权益类'], fi = catCnt['固收类'], cm = catCnt['商品类'], fo = catCnt['FOF类'];
  const tone = eq > fi + cm + fo
    ? `进取型配置：以权益类基金为主（${eq}只），进攻性较强，适合风险承受能力较高的客户，需注意权益市场的波动回撤。`
    : (fi > eq + cm + fo
      ? `稳健型配置：以固收类基金为主（${fi}只），波动较低、回撤可控，适合作为组合的压舱石，收益弹性相对有限。`
      : '均衡型配置：权益与固收/商品类基金数量接近，兼顾收益弹性与防守，适合风险偏好适中的客户长期持有。');

  const tags = [
    `<span class="po-tag blue">📦 ${n}只基金</span>`,
    eq ? `<span class="po-tag purple">📈 权益${eq}只</span>` : '',
    fi ? `<span class="po-tag green">🔒 固收${fi}只</span>` : '',
    cm ? `<span class="po-tag amber">⛏ 商品${cm}只</span>` : '',
    fo ? `<span class="po-tag amber">📋 FOF ${fo}只</span>` : '',
    `<span class="po-tag pink">🧭 核心${posCnt['核心配置']}·卫星${posCnt['卫星配置']}·机会${posCnt['机会型配置']}</span>`,
  ].join('');

  const strat = [['权益类', eq, '#4f46e5', '#ede9fe'], ['固收类', fi, '#059669', '#d1fae5'],
    ['商品类', cm, '#b45309', '#fef3c7'], ['FOF类', fo, '#d97706', '#fef3c7']]
    .filter(([, c]) => c > 0)
    .map(([name, c, color, bg]) =>
      `<div class="item" style="background:${bg};border:1px solid ${color}22"><span class="num" style="color:${color}">${c}只</span><br><span>${name}</span></div>`).join('');

  const review = `<strong>组合配置综述：</strong>${tone} 配置结构上以${fi >= eq ? '固收+均衡' : '权益增强'}为主，核心配置${posCnt['核心配置']}只作为底仓，卫星配置${posCnt['卫星配置']}只提供超额收益弹性，机会型${posCnt['机会型配置']}只作为阶段性补充（需结合客户风险偏好调整）。`;

  return `<div class="po-wrap">
    <div class="po-title">📊 组合配置总览</div>
    <div class="po-tags">${tags}</div>
    <div class="po-strategy">${strat}</div>
    <div class="po-review">${review}</div>
  </div>`;
}

// 单基金卡片
function renderCard(d) {
  const code = d.code, name = d.name || code, type = d.type || '';
  const r = d.report || {};
  const v = r.verdict || { label: '—', color: '#64748b', emoji: '—' };
  const p = r.position || { label: '机会型配置', cls: 'opp' };
  const reasons = r.reasons || {};

  // 近3月收益
  const p3 = (d.perf || []).find(x => x.period === '近3月');
  const ret3 = p3 ? p3.returns : 'N/A';
  const retCls = String(ret3).startsWith('-') ? 'ret-neg' : (String(ret3).startsWith('+') ? 'ret-pos' : 'type');

  const summary = `<div class="card-summary" onclick="toggleCard(this)">
    <div class="summary-left">
      <div class="fund-name">${esc(name)}<span class="code">${code}</span></div>
      <div class="fund-tags">
        <span class="tag type">${esc(type)}</span>
        <span class="tag ${retCls}">近3月 ${esc(ret3)}</span>
        <span class="tag pos-${p.cls}">${esc(p.label)}</span>
      </div>
    </div>
    <div class="summary-right">
      <div class="verdict-large" style="color:${v.color}">${v.emoji} ${esc(v.label)}</div>
      <div class="expand-icon">▼ 点击展开详情</div>
    </div>
  </div>`;

  // 名片
  const mgrChg = (d.managerChanges || [])[0] || {};
  const mgrName = d.currentManager || mgrChg.name || '—';
  const mgrStart = d.managerStartDate || mgrChg.from || '—';
  const feeItems = [['管理费', d.mgmtFee], ['托管费', d.custodyFee], ['销售服务费', d.serviceFee || '无'], ['申购费', d.buyFee], ['赎回费', d.redeemFee || '—']]
    .map(([l, val]) => `<span class="fee-item"><span class="fee-label">${l}：</span>${esc(val || '—')}</span>`).join('');
  const info = `<div class="sec-title">📄 基金名片</div>
    <div class="info-grid">
      <div><span class="label">类型</span><br><span class="value">${esc(type)}</span></div>
      <div><span class="label">基金管理人</span><br><span class="value">${esc(d.managerName || '—')}</span></div>
      <div><span class="label">成立日期</span><br><span class="value">${esc(d.foundDate || '—')}</span></div>
      <div><span class="label">最新规模</span><br><span class="value">${esc(d.scale || '—')}</span></div>
      ${d.benchmark ? `<div><span class="label">业绩比较基准</span><br><span class="value" style="font-size:.74rem">${esc(d.benchmark)}</span></div>` : ''}
      <div class="fee-grid">${feeItems}</div>
      <div class="mgr-inline">
        <span><span class="label">基金经理：</span>${esc(mgrName)}</span>
        <span><span class="label">任职起始：</span>${esc(mgrStart)}</span>
        ${d.managerProductCount ? `<span><span class="label">在管：</span>${d.managerProductCount}只</span>` : ''}
      </div>
    </div>`;

  // 推荐理由（六段）
  const reasonOrder = [['配置定位', '🎯 配置定位'], ['定位与策略', '🧭 定位与策略'], ['业绩支撑', '📊 业绩支撑'],
    ['基金经理', '👤 基金经理'], ['规模信号', '📦 规模信号'], ['风险提示', '⚠️ 风险提示']];
  const reasonHtml = reasonOrder.map(([k, label]) =>
    reasons[k] ? `<div class="reason-item"><span class="r-label">${label}：</span>${esc(reasons[k])}</div>` : '').join('');
  const reasonSec = reasonHtml ? `<div class="sec-title">📋 推荐理由/配置逻辑</div><div class="reason-box">${reasonHtml}</div>` : '';

  // 规模趋势
  const st = d.scaleTrend || [];
  const scaleSec = st.length > 1
    ? `<div class="sec-title">📈 规模趋势</div><div class="chart-wrap"><canvas id="c_${code}"></canvas></div>`
    : `<div class="sec-title">📈 规模趋势</div><div class="chart-empty">暂无季度规模数据</div>`;

  // 业绩表现
  const rows = (d.perf || []).map(p => {
    const up = String(p.returns).startsWith('+');
    const qc = { '优秀': 'bull', '良好': 'neutral', '一般': 'neutral', '不佳': 'bear' }[p.quartile] || 'neutral';
    return `<tr><td>${esc(p.period)}</td><td class="${up ? 'pos' : 'neg'}">${esc(p.returns || '—')}</td><td>${esc(p.avg || '—')}</td><td>${esc(p.periodDd || '—')}</td><td>${esc(p.rank || '—')}</td><td><span class="tag-q ${qc}">${esc(p.quartile || '—')}</span></td></tr>`;
  }).join('');
  const rm = d.riskMetrics || {};
  const mddNote = rm.maxDrawdown ? `<div class="mdd-warn">⚠️ 历史最大回撤 ${Math.abs(parseFloat(rm.maxDrawdown)).toFixed(2)}%（${esc(rm.peakDate || '?')} ~ ${esc(rm.troughDate || '至今')}${rm.recoveryDays != null ? '，修复' + rm.recoveryDays + '天' : ''}）</div>` : '';
  const perfSec = `<div class="sec-title">📊 业绩表现</div>
    <div class="chart-wrap"><canvas id="nav_${code}"></canvas></div>
    ${mddNote}
    <table class="perf-table"><thead><tr><th>周期</th><th>收益率</th><th>同类平均</th><th>最大回撤</th><th>排名</th><th>四分位</th></tr></thead><tbody>${rows}</tbody></table>`;

  // 持仓
  const holds = d.holdings || [];
  const holdRows = holds.length ? holds.map((h, i) =>
    `<tr><td style="width:26px;color:#9ca3af">${i + 1}</td><td>${esc(h.name)}</td><td>${h.code ? esc(h.code) : '—'}</td><td style="color:var(--red);font-weight:600">${(h.pct || 0).toFixed(2)}%</td></tr>`).join('')
    : `<tr><td colspan="4" style="color:#9ca3af;padding:10px;text-align:center">暂无股票持仓数据</td></tr>`;
  const hc = d.holdingsClassified || {};
  const hcTags = (hc.equityPct > 0 || hc.fixedIncomePct > 0) ? `<div style="margin-bottom:5px"><span class="tag type">权益 ${hc.equityPct || 0}%</span> <span class="tag type" style="background:#dcfce7;color:#166534">固收 ${hc.fixedIncomePct || 0}%</span></div>` : '';
  const holdSec = holds.length ? `<div class="sec-title">🔍 持仓明细${d.holdQuarter ? '（' + esc(d.holdQuarter) + '）' : ''}</div>${hcTags}
    <table class="holding-table"><thead><tr><th>#</th><th>股票名称</th><th>代码</th><th>占净值</th></tr></thead><tbody>${holdRows}</tbody></table>` : '';

  // 配置建议（旧版文本）
  const adviceSec = d.configAdvice ? `<div class="sec-title">💡 配置建议</div><div class="note-box">${esc(d.configAdvice)}</div>` : '';

  const detail = `<div class="card-detail">${info}${reasonSec}${scaleSec}${perfSec}${holdSec}${adviceSec}</div>`;
  return `<div class="fund-card">${summary}${detail}</div>`;
}
