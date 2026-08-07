// 工作台交互逻辑：登录态、搜索/排名、已选管理、生成配置建议
const TOKEN_KEY = 'wb_token';
let selected = new Map(); // code -> {code,name,type}
let curPage = 1, curMode = 'search'; // search | rank
let rankSc = '1nzf', rankFt = 'all';

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

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

// ===== 搜索（代码/关键词 + 分类多选 + 公司多选 组合筛选）=====
async function doSearch(page) {
  curMode = 'search'; curPage = page || 1;
  const q = document.getElementById('fQ').value.trim();
  const cats = [...selCats].join(',');
  const comps = [...selComps].join(',');
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cats)}&company=${encodeURIComponent(comps)}&page=${curPage}&size=30`);
    renderRes(d);
  } catch (e) { showResErr(e.message); }
}

// ===== 排名（按窗口；所选区间收益率直接展示在列表）=====
async function doRank(page) {
  curMode = 'rank'; curPage = page || 1;
  // rankhandler 大类映射（指数/股票/混合/债券/QDII/FOF；货币与商品不参与涨跌幅排名）
  const FT_MAP = { '指数型': 'zs', '股票型': 'gp', '混合型': 'hh', '债券型': 'zq', 'QDII': 'qdii', 'FOF': 'fof' };
  const cats = [...selCats];
  rankFt = cats.length === 1 ? (FT_MAP[cats[0]] || 'all') : 'all';
  const scLabel = ({ '1yzf': '近1月', '3yzf': '近3月', '1nzf': '近1年', '2nzf': '近2年', '3nzf': '近3年' })[rankSc] || '近1年';
  try {
    const d = await api(`/api/rank?sc=${rankSc}&ft=${rankFt}&page=${curPage}&size=50`);
    const list = d.list.map((x, i) => ({ code: x.code, name: x.name, type: 'rank', ret: x.returns, rank: x.rank, scLabel }));
    renderRes({ total: d.allNum, list, isRank: true });
  } catch (e) { showResErr(e.message); }
}

function showResErr(msg) {
  document.getElementById('resList').innerHTML = `<div class="res-empty">${esc(msg)}</div>`;
}

function renderRes(d) {
  const box = document.getElementById('resList');
  const moreBtn = document.getElementById('moreBtn');
  if (!d.list.length) { box.innerHTML = '<div class="res-empty">未找到匹配基金</div>'; moreBtn.style.display = 'none'; return; }
  box.innerHTML = d.list.map(x => {
    const on = selected.has(x.code);
    const isRank = !!d.isRank;
    // 排名模式：所选区间收益率醒目展示（红涨绿跌，中国习惯）
    let retHtml = '';
    let metaHtml = '';
    if (isRank) {
      const rv = String(x.ret == null ? '' : x.ret);
      const up = rv !== '' && rv !== '—' && !rv.startsWith('-');
      const down = rv !== '' && rv !== '—' && rv.startsWith('-');
      if (rv && rv !== '—') retHtml = `<div class="res-ret ${up ? 'up' : down ? 'down' : ''}">${up ? '+' : ''}${esc(rv)}%</div>`;
      metaHtml = `${x.scLabel || '区间'}收益率 · 第${x.rank}名`;
    } else {
      metaHtml = esc(x.type);
    }
    return `<div class="res-item">
      <div class="info">
        <div class="name">${esc(x.name)}<span class="res-code">${x.code}</span></div>
        <div class="meta">${metaHtml}</div>
      </div>
      ${retHtml}
      <button class="add ${on ? 'on' : ''}" onclick="toggleSel('${x.code}','${esc(x.name).replace(/'/g, "\\'")}','${esc(isRank ? '' : x.type)}')">${on ? '已选 ✓' : '加入'}</button>
    </div>`;
  }).join('');
  moreBtn.style.display = d.total > curPage * 50 ? 'block' : 'none';
}

function loadMore() { curPage++; curMode === 'rank' ? doRank(curPage) : doSearch(curPage); }

// ===== 已选管理 =====
function toggleSel(code, name, type) {
  if (selected.has(code)) { selected.delete(code); }
  else { selected.set(code, { code, name, type }); }
  renderSel();
  doSearch(curPage); // 刷新加入按钮状态（轻量）
}
function clearSel() { selected.clear(); renderSel(); }

// ===== 多选筛选：分类 chips + 公司搜索 =====
let selCats = new Set();       // 已选分类
let selComps = new Set();      // 已选公司（核心词）
let _allComps = [];            // 全部公司（用于本地搜索建议）

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
}

// ===== 视图切换：工作台 <-> 报告页 =====
function showReportView() {
  document.getElementById('wbView').style.display = 'none';
  document.getElementById('reportView').style.display = 'block';
  window.scrollTo(0, 0);
}
function backToWorkbench() {
  document.getElementById('reportView').style.display = 'none';
  document.getElementById('wbView').style.display = 'block';
  window.scrollTo(0, 0);
}

// ===== 生成报告（进入报告视图） =====
async function generate() {
  const codes = [...selected.keys()];
  if (!codes.length) return;
  const out = document.getElementById('out');
  const loading = document.getElementById('loading');
  showReportView();
  loading.style.display = 'block';
  out.innerHTML = '';
  try {
    const d = await api('/api/funds', { method: 'POST', body: JSON.stringify({ codes }) });
    loading.style.display = 'none';
    const ok = d.funds.filter(f => f.ok);
    const bad = d.funds.filter(f => !f.ok);
    if (!ok.length) { out.innerHTML = '<div class="res-empty">所有基金获取失败，请检查代码后重试</div>'; return; }
    const fundsData = ok.map(f => f.data);
    // 注册图表数据
    fundsData.forEach(fd => registerCharts(fd));
    out.innerHTML = renderOverview(fundsData) + ok.map(f => renderCard(f.data)).join('') +
      (bad.length ? `<div class="res-empty">以下基金获取失败：${bad.map(b => b.code).join('、')}（请返回重新选择）</div>` : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    loading.style.display = 'none';
    out.innerHTML = `<div class="res-empty">${esc(e.message)}</div>`;
  }
}

init();
