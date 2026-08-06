// 工作台交互逻辑：登录态、搜索/排名、已选管理、生成配置建议
const TOKEN_KEY = 'wb_token';
let selected = new Map(); // code -> {code,name,type}
let curPage = 1, curMode = 'search'; // search | rank
let rankSc = '1nzf', rankFt = 'all';

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + getToken() }, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, Object.assign({}, opts, { headers }));
  if (r.status === 401) { location.href = 'login.html'; throw new Error('未登录'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '请求失败');
  return d;
}

function logout() { localStorage.removeItem(TOKEN_KEY); location.href = 'login.html'; }

// ===== 初始化 =====
async function init() {
  if (!getToken()) { location.href = 'login.html'; return; }
  try {
    await api('/api/me');
  } catch (e) { return; }
  // 类型下拉
  try {
    const d = await api('/api/types');
    const sel = document.getElementById('fType');
    sel.innerHTML = '<option value="">全部类型</option>' + d.types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  } catch (e) {}
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

// ===== 搜索 =====
async function doSearch(page) {
  curMode = 'search'; curPage = page || 1;
  const q = document.getElementById('fQ').value.trim();
  const type = document.getElementById('fType').value;
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&page=${curPage}&size=30`);
    renderRes(d);
  } catch (e) { showResErr(e.message); }
}

// ===== 排名 =====
async function doRank(page) {
  curMode = 'rank'; curPage = page || 1;
  rankFt = document.getElementById('fFt').value;
  try {
    const d = await api(`/api/rank?sc=${rankSc}&ft=${rankFt}&page=${curPage}&size=50`);
    const list = d.list.map((x, i) => ({ code: x.code, name: x.name, type: 'rank', ret: x.returns, rank: x.rank }));
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
    const retTag = x.ret ? `<span class="tag ${String(x.ret).startsWith('-') ? 'ret-neg' : 'ret-pos'}">${esc(x.ret)}${x.ret !== '—' ? '%' : ''}</span>` : '';
    return `<div class="res-item">
      <div class="info">
        <div class="name">${esc(x.name)}<span style="color:var(--text-muted);font-weight:400;font-size:.72rem;margin-left:4px">${x.code}</span></div>
        <div class="meta">${esc(x.type === 'rank' ? '业绩排名' : x.type)}${x.rank ? ` · 第${x.rank}名` : ''}</div>
      </div>
      <button class="add ${on ? 'on' : ''}" onclick="toggleSel('${x.code}','${esc(x.name).replace(/'/g, "\\'")}','${esc(x.type === 'rank' ? '' : x.type)}')">${on ? '已选 ✓' : '加入'}</button>
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

function renderSel() {
  const box = document.getElementById('selList');
  const cnt = document.getElementById('selCount');
  const btn = document.getElementById('genBtn');
  cnt.textContent = selected.size ? `（${selected.size} 只）` : '';
  box.innerHTML = selected.size ? [...selected.values()].map(s =>
    `<span class="sel-chip">${esc(s.name)}<span class="x" onclick="toggleSel('${s.code}','${esc(s.name).replace(/'/g, "\\'")}','${esc(s.type)}')">✕</span></span>`).join('')
    : '<span class="sel-empty">尚未选择基金</span>';
  btn.textContent = `🎯 生成配置建议（已选 ${selected.size} 只）`;
  btn.disabled = selected.size === 0;
}

// ===== 生成配置建议 =====
async function generate() {
  const codes = [...selected.keys()];
  if (!codes.length) return;
  const out = document.getElementById('out');
  const loading = document.getElementById('loading');
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
      (bad.length ? `<div class="res-empty">以下基金获取失败：${bad.map(b => b.code).join('、')}（请重新选择）</div>` : '');
    window.scrollTo({ top: document.getElementById('out').offsetTop - 80, behavior: 'smooth' });
  } catch (e) {
    loading.style.display = 'none';
    out.innerHTML = `<div class="res-empty">${esc(e.message)}</div>`;
  }
}

init();
