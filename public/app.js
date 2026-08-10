// 工作台交互逻辑：登录态、搜索/排名、已选管理、生成配置建议
const TOKEN_KEY = 'wb_token';
const SEL_KEY = 'wb_selected';   // 已选组合持久化（记忆上次会话）
let selected = new Map(); // code -> {code,name,type}
let curPage = 1, curMode = 'search'; // search | rank
let rankSc = '1nzf', rankFt = 'all';

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

// 已选组合持久化：每次变化写入 localStorage（换设备可用导出/导入迁移）
function saveSel() {
  try { localStorage.setItem(SEL_KEY, JSON.stringify([...selected.values()])); } catch (e) {}
}
function loadSel() {
  try {
    const arr = JSON.parse(localStorage.getItem(SEL_KEY) || '[]');
    if (Array.isArray(arr)) arr.forEach(s => { if (s && s.code) selected.set(s.code, { code: s.code, name: s.name || s.code, type: s.type || '' }); });
  } catch (e) {}
}

// 带自动重试的请求封装（网络抖动/服务瞬断自动重试，缓解"无数据"）
async function api(path, opts = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = Object.assign({ 'Authorization': 'Bearer ' + getToken() }, opts.headers || {});
      if (opts.body) headers['Content-Type'] = 'application/json';
      const r = await fetch(path, Object.assign({}, opts, { headers }));
      if (r.status === 401) { location.href = 'login.html'; throw new Error('未登录'); }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '请求失败');
      return d;
    } catch (e) {
      lastErr = e;
      if (e.message === '未登录') throw e;
      if (attempt < retries) await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function logout() { localStorage.removeItem(TOKEN_KEY); location.href = 'login.html'; }

// ===== 初始化 =====
async function init() {
  if (!getToken()) { location.href = 'login.html'; return; }
  try {
    await api('/api/me');
  } catch (e) { return; }
  // 记忆上次已选组合
  loadSel();
  if (selected.size) renderSel();
  // 基金公司列表（用于多选搜索建议）
  try {
    const d = await api('/api/companies');
    _allComps = d.companies || [];
  } catch (e) {}
  initMultiFilter();
  // 排名 tabs
  document.querySelectorAll('#rankTabs .tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('#rankTabs .tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      rankSc = t.dataset.sc;
      doRank(1);
    };
  });
  doSearch(1);
}

// ===== 今日要处理条 =====
function updateTodayBar() {
  const bar = document.getElementById('todayBar');
  if (!bar) return;
  const txt = document.getElementById('todayText');
  const n = selected.size;
  if (n) {
    const md = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    txt.textContent = `继续上次组合（${n} 只）· 净值数据实时抓取自天天基金（${md}）`;
    bar.style.display = 'block';
  } else { bar.style.display = 'none'; }
}

// ===== 代码输入：单输入框 + 添加按钮 =====
let _adding = false;
async function addByCode() {
  const input = document.getElementById('codeInput');
  const code = (input.value || '').trim();
  if (!code) return;
  if (!/^\d{6}$/.test(code)) { input.value = ''; input.focus(); return; }
  if (_adding) return;
  _adding = true;
  input.disabled = true;
  const btn = input.nextElementSibling;
  const oldTxt = btn ? btn.textContent : '';
  if (btn) btn.textContent = '查询中…';
  try {
    const d = await api('/api/fund', { method: 'POST', body: JSON.stringify({ code }) });
    if (selected.has(code)) { }
    else { selected.set(code, { code, name: d.name || code, type: d.type || '' }); renderSel(); }
    input.value = '';
  } catch (e) { input.value = ''; }
  input.disabled = false;
  if (btn) btn.textContent = oldTxt;
  _adding = false;
  input.focus();
}

// ===== 搜索（关键词 + 分类/公司/规模/成立/申购 多选组合筛选）=====
const SC_LABELS = { '1yzf': '近1月', '3yzf': '近3月', '1nzf': '近1年', '2nzf': '近2年', '3nzf': '近3年' };

// 是否处于"筛选"状态（有任一筛选条件）——有筛选时排名窗口在筛选范围内生效
function hasFilter() {
  const q = document.getElementById('fQ').value.trim();
  return !!(q || selCats.size || selComps.size || selScales.size || selAges.size || selBuy.size || selCur.size);
}

// 构造筛选查询串（不含分页）
function filterQuery() {
  const q = document.getElementById('fQ').value.trim();
  const cats = [...selCats].join(',');
  const comps = [...selComps].join(',');
  const scales = [...selScales].join(',');
  const ages = [...selAges].join(',');
  const buyable = [...selBuy][0] || '';
  const currency = [...selCur][0] || '';
  return `q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cats)}&company=${encodeURIComponent(comps)}&scales=${encodeURIComponent(scales)}&ages=${encodeURIComponent(ages)}&buyable=${encodeURIComponent(buyable)}&currency=${encodeURIComponent(currency)}`;
}

async function doSearch(page) {
  curMode = 'search'; curPage = page || 1;
  const sc = hasFilter() ? rankSc : ''; // 有筛选 → 按当前排名窗口收益率排序
  if (sc) showResLoading('正在计算收益率排序…');
  try {
    const d = await api(`/api/search?${filterQuery()}&sc=${sc}&page=${curPage}&size=30`);
    if (sc) {
      const scLabel = SC_LABELS[rankSc] || '近1年';
      const list = d.list.map(x => ({ code: x.code, name: x.name, type: x.type, ret: x.ret, rank: x.rank, scLabel }));
      renderRes({ total: d.total, list, isRank: true, tooMany: d.tooMany });
    } else {
      renderRes(d);
    }
  } catch (e) { showResErr(e.message); }
}

// ===== 排名（按窗口；有筛选→筛选范围内排序，无筛选→全市场排名）=====
async function doRank(page) {
  curMode = 'rank'; curPage = page || 1;
  const scLabel = SC_LABELS[rankSc] || '近1年';
  if (hasFilter()) {
    // 筛选范围内按所选窗口收益率排序（与筛选联动）
    showResLoading('正在计算收益率排序…');
    try {
      const d = await api(`/api/search?${filterQuery()}&sc=${rankSc}&page=${curPage}&size=30`);
      const list = d.list.map(x => ({ code: x.code, name: x.name, type: x.type, ret: x.ret, rank: x.rank, scLabel }));
      renderRes({ total: d.total, list, isRank: true, tooMany: d.tooMany });
    } catch (e) { showResErr(e.message); }
  } else {
    // 无筛选：全市场排名
    try {
      const d = await api(`/api/rank?sc=${rankSc}&ft=all&page=${curPage}&size=50`);
      const list = d.list.map((x, i) => ({ code: x.code, name: x.name, type: 'rank', ret: x.returns, rank: x.rank, scLabel }));
      renderRes({ total: d.allNum, list, isRank: true });
    } catch (e) { showResErr(e.message); }
  }
}

function showResLoading(msg) {
  document.getElementById('resList').innerHTML = `<div class="res-empty" style="padding:22px 0">⏳ ${esc(msg)}</div>`;
}

function showResErr(msg) {
  document.getElementById('resList').innerHTML = `<div class="res-empty">${esc(msg)}</div>`;
}

function renderRes(d) {
  const box = document.getElementById('resList');
  const moreBtn = document.getElementById('moreBtn');
  if (!d.list.length) { box.innerHTML = '<div class="res-empty">未找到匹配基金</div>'; moreBtn.style.display = 'none'; return; }
  const tooManyHtml = d.tooMany ? `<div class="res-warn">共 ${d.total} 只，结果较多暂按默认顺序浏览；可再添加公司/规模/币种等条件后按收益率排名</div>` : '';
  box.innerHTML = tooManyHtml + d.list.map(x => {
    const on = selected.has(x.code);
    // 收益率（筛选联动后所有列表都可能带）
    const hasRet = x.ret != null && x.ret !== '' && x.ret !== '—';
    let retHtml = '';
    if (hasRet) {
      const rv = String(x.ret);
      const up = !rv.startsWith('-');
      retHtml = `<div class="res-ret ${up ? 'up' : 'down'}">${up ? '+' : ''}${esc(rv)}%</div>`;
    } else if (x.scLabel) {
      retHtml = '<div class="res-ret muted">—</div>';
    }
    // meta：窗口收益率 + 排名，或类型
    const metaHtml = x.scLabel ? `${x.scLabel}收益率${x.rank ? ` · 第${x.rank}名` : ''}` : esc(x.type);
    return `<div class="res-item">
      <div class="info">
        <div class="name">${esc(x.name)}<span class="res-code">${x.code}</span></div>
        <div class="meta">${metaHtml}</div>
      </div>
      ${retHtml}
      <button class="add ${on ? 'on' : ''}" onclick="toggleSel('${x.code}','${esc(x.name).replace(/'/g, "\\'")}','${esc(x.scLabel ? '' : x.type)}')">${on ? '已选 ✓' : '加入'}</button>
    </div>`;
  }).join('');
  moreBtn.style.display = d.total > curPage * (d.isRank ? 50 : 30) ? 'block' : 'none';
}

function loadMore() { curPage++; curMode === 'rank' ? doRank(curPage) : doSearch(curPage); }

// ===== 已选管理 =====
function toggleSel(code, name, type) {
  if (selected.has(code)) { selected.delete(code); }
  else { selected.set(code, { code, name, type }); }
  renderSel();
  doSearch(curPage); // 刷新加入按钮状态（轻量）
}
function clearSel() {
  if (!selected.size) return;
  if (!confirm('确定清空全部已选基金？')) return;
  selected.clear(); renderSel();
}

// ===== 组合备份：导出 JSON / 导入恢复 =====
function exportSel() {
  if (!selected.size) { alert('已选组合为空，无需导出'); return; }
  const payload = { app: 'fund-workbench', version: 1, exportedAt: new Date().toISOString(), funds: [...selected.values()] };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '基金组合_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}
function importSel(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : (data.funds || []);
      if (!arr.length) { alert('导入文件格式不正确'); return; }
      const ok = arr.filter(s => s && /^\d{6}$/.test(s.code));
      if (!ok.length) { alert('导入文件中没有有效基金代码'); return; }
      ok.forEach(s => selected.set(s.code, { code: s.code, name: s.name || s.code, type: s.type || '' }));
      renderSel();
      doSearch(1);
      alert(`已导入 ${ok.length} 只基金`);
    } catch (e) { alert('导入失败：文件不是有效的 JSON'); }
    ev.target.value = '';
  };
  reader.readAsText(file);
}

// ===== 多选筛选：分类 chips + 公司搜索 + 规模/成立/申购 =====
let selCats = new Set();       // 已选分类
let selComps = new Set();      // 已选公司（核心词）
let selScales = new Set();     // 已选规模分档
let selAges = new Set();       // 已选成立时长分档
let selBuy = new Set();        // 已选申购状态
let selCur = new Set();        // 已选购买币种
let _allComps = [];            // 全部公司（用于本地搜索建议）

function toggleMore() {
  const box = document.getElementById('moreFilter');
  const on = box.style.display !== 'none';
  box.style.display = on ? 'none' : 'block';
  const a = document.querySelector('.more-toggle .arrow');
  if (a) a.textContent = on ? '▾' : '▴';
}

function initMultiFilter() {
  // 分类 chips 点击切换多选
  document.querySelectorAll('#catChips .chip').forEach(ch => {
    ch.onclick = () => {
      const cat = ch.dataset.cat;
      if (selCats.has(cat)) { selCats.delete(cat); ch.classList.remove('on'); }
      else { selCats.add(cat); ch.classList.add('on'); }
      doSearch(1);
    };
  });
  // 规模/成立时长/申购状态/购买币种 chips（多选）
  const groups = { scale: selScales, age: selAges, buy: selBuy, cur: selCur };
  document.querySelectorAll('#moreFilter .tabs[data-g] .chip').forEach(ch => {
    ch.onclick = () => {
      const set = groups[ch.parentElement.dataset.g];
      const v = ch.dataset.v;
      if (set.has(v)) { set.delete(v); ch.classList.remove('on'); }
      else { set.add(v); ch.classList.add('on'); }
      doSearch(1);
    };
  });
}
function companySuggest(v) {
  v = (v || '').trim();
  const box = document.getElementById('compSuggest');
  if (!v) { box.innerHTML = ''; return; }
  const hits = _allComps.filter(c => c.includes(v)).slice(0, 8);
  if (!hits.length) { box.innerHTML = ''; return; }
  box.innerHTML = hits.map(c => {
    const on = selComps.has(c);
    return `<div class="comp-item ${on ? 'on' : ''}" onclick="pickCompany('${esc(c).replace(/'/g, "\\'")}')">${esc(c)}${on ? ' ✓' : ''}</div>`;
  }).join('');
}
function pickCompany(c) {
  if (selComps.has(c)) { selComps.delete(c); }
  else { selComps.add(c); }
  document.getElementById('fCompany').value = '';
  document.getElementById('compSuggest').innerHTML = '';
  renderCompSel();
  doSearch(1);
}
function renderCompSel() {
  const box = document.getElementById('compSel');
  box.innerHTML = selComps.size ? [...selComps].map(c =>
    `<span class="sel-chip">${esc(c)}<span class="x" onclick="pickCompany('${esc(c).replace(/'/g, "\\'")}')">✕</span></span>`).join('')
    : '';
}

function renderSel() {
  const box = document.getElementById('selList');
  const cnt = document.getElementById('selCount');
  const btn = document.getElementById('genBtn');
  cnt.textContent = selected.size ? `（${selected.size} 只）` : '';
  box.innerHTML = selected.size ? [...selected.values()].map(s =>
    `<span class="sel-chip">${esc(s.name)}<span class="x" onclick="toggleSel('${s.code}','${esc(s.name).replace(/'/g, "\\'")}','${esc(s.type)}')">✕</span></span>`).join('')
    : '<span class="sel-empty">尚未选择基金</span>';
  btn.textContent = `🎯 生成报告${selected.size ? `（${selected.size} 只）` : ''}`;
  btn.disabled = selected.size === 0;
  // 同步移动端底部生成栏
  const btnM = document.getElementById('genBtnM');
  if (btnM) {
    btnM.textContent = `🎯 生成报告${selected.size ? `（${selected.size} 只）` : ''}`;
    btnM.disabled = selected.size === 0;
  }
  saveSel();           // 持久化已选组合
  updateTodayBar();    // 刷新今日要处理条
}

// ===== 视图切换：工作台 <-> 报告页 =====
function showReportView() {
  document.getElementById('wbView').style.display = 'none';
  document.getElementById('reportView').style.display = 'block';
  setMTab('report');
  window.scrollTo(0, 0);
}
function backToWorkbench() {
  document.getElementById('reportView').style.display = 'none';
  document.getElementById('wbView').style.display = 'block';
  setMTab('work');
  window.scrollTo(0, 0);
}

// 移动端底部 Tab 切换（工作台 / 报告）
function mTab(tab) {
  if (tab === 'report') {
    const out = document.getElementById('out');
    if (!out || !out.innerHTML.trim() || out.innerHTML.includes('loading')) { alert('请先点「生成报告」生成配置建议'); return; }
    showReportView();
  } else { backToWorkbench(); }
}
function setMTab(tab) {
  const w = document.getElementById('mTabWork'), r = document.getElementById('mTabRep');
  if (w) w.classList.toggle('on', tab === 'work');
  if (r) r.classList.toggle('on', tab === 'report');
}

// 生成进度条（顶部滑动条）
let _progressEl = null;
function showProgress() {
  if (!_progressEl) {
    _progressEl = document.createElement('div');
    _progressEl.className = 'gen-progress';
    document.body.appendChild(_progressEl);
  }
  _progressEl.style.display = 'block';
}
function hideProgress() {
  if (_progressEl) _progressEl.style.display = 'none';
}

// ===== 生成报告（进入报告视图） =====
async function generate() {
  const codes = [...selected.keys()];
  if (!codes.length) return;
  const out = document.getElementById('out');
  const loading = document.getElementById('loading');
  showReportView();
  showProgress();
  loading.style.display = 'block';
  out.innerHTML = '';
  const banner = document.getElementById('reportBanner');
  if (banner) banner.style.display = 'none';
  try {
    const d = await api('/api/funds', { method: 'POST', body: JSON.stringify({ codes }) });
    loading.style.display = 'none';
    hideProgress();
    const ok = d.funds.filter(f => f.ok);
    const bad = d.funds.filter(f => !f.ok);
    if (!ok.length) { out.innerHTML = '<div class="res-empty">所有基金获取失败，请检查代码后重试</div>'; return; }
    const fundsData = ok.map(f => f.data);
    // 注册图表数据
    fundsData.forEach(fd => registerCharts(fd));
    out.innerHTML = renderOverview(fundsData) + ok.map(f => renderCard(f.data)).join('') +
      (bad.length ? `<div class="res-empty">以下基金获取失败：${bad.map(b => b.code).join('、')}（请返回重新选择）</div>` : '');
    // 成功横幅
    if (banner) {
      banner.innerHTML = `✅ 报告已生成（${ok.length} 只基金）`;
      banner.style.display = 'block';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    loading.style.display = 'none';
    hideProgress();
    out.innerHTML = `<div class="res-empty">${esc(e.message)}</div>`;
  }
}

init();
