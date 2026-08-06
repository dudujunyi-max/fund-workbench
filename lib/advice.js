// 报告字段：业绩判定（底色×趋势9格）+ 配置定位（核心/卫星/机会）+ 六段推荐理由
// 移植自「重点基金配置建议」skill 的 gen_report.py

const VERDICT_STYLE={
  '表现优异':{color:'#16a34a',emoji:'✅'},
  '表现良好':{color:'#2563eb',emoji:'👍'},
  '表现一般':{color:'#64748b',emoji:'—'},
  '建议调整':{color:'#d97706',emoji:'👀'},
};
const POSITION_STYLE={
  '核心配置':{color:'#1e40af',bg:'#dbeafe',cls:'core'},
  '卫星配置':{color:'#5b21b6',bg:'#ede9fe',cls:'sat'},
  '机会型配置':{color:'#92400e',bg:'#fef3c7',cls:'opp'},
};
const MATRIX={
  '好|改善':'表现优异','好|平稳':'表现优异','好|恶化':'表现良好',
  '中|改善':'表现良好','中|平稳':'表现一般','中|恶化':'建议调整',
  '差|改善':'表现一般','差|平稳':'建议调整','差|恶化':'建议调整',
};
const Q_SCORE={'优秀':4,'良好':3,'一般':2,'不佳':1};

function classify(ftype){
  const t=ftype||'';
  if(/股票|偏股|灵活配置|混合型-灵活|混合型-偏股|混合|港股/.test(t))return'权益类';
  if(/债|货币|理财/.test(t))return'固收类';
  if(/商品|期货|黄金|原油/.test(t))return'商品类';
  if(/FOF|养老/i.test(t))return'FOF类';
  return'其他';
}

function hasData(v){return v&&v!=='—'&&v!=='--';}

// perf 为 fetchAll 的数组 [{period,returns,avg,rank,quartile,periodDd}]
function perfMap(perf){
  const d={};
  for(const p of(perf||[]))d[p.period]={收益率:p.returns,四分位:p.quartile,排名:p.rank};
  return d;
}

function calcVerdict(perf,mgrChanged){
  const d=perfMap(perf);
  const q=idx=>Q_SCORE[d[idx]?.四分位]||0;
  const ql=idx=>d[idx]?.四分位||'';
  const y3l=ql('近3年'),y2l=ql('近2年'),y1l=ql('近1年');
  let base;
  if(mgrChanged&&hasData(y2l)){
    base=y2l==='优秀'&&['优秀','良好'].includes(y1l)?'好':(y2l==='不佳'&&y1l!=='优秀'?'差':'中');
  }else if(hasData(y3l)){
    base=(y3l==='优秀'||(y3l==='良好'&&['良好','优秀'].includes(y1l)))?'好':(y3l==='不佳'?'差':'中');
  }else if(hasData(y2l)){
    base=y2l==='优秀'?'好':(y2l==='不佳'?'差':'中');
  }else{
    base=y1l==='优秀'?'好':(y1l==='不佳'?'差':'中');
  }
  const m3q=q('近3月'),m6q=q('近6月');
  let trend='平稳';
  if(m3q&&m6q){
    trend=(m3q<=2&&m6q<=2)?'恶化':(m3q>m6q?'改善':(m3q<m6q?'恶化':'平稳'));
  }
  const label=MATRIX[base+'|'+trend]||'表现一般';
  const s=VERDICT_STYLE[label];
  return{label,color:s.color,emoji:s.emoji};
}

function tenureYears(t){
  const m=String(t||'').match(/(\d+)年/);
  return m?parseInt(m[1]):0;
}

function calcPosition(d,verdictLabel){
  const scale=parseFloat(d.scale)||0;
  const st=d.scaleTrend||[];
  let shrink=0;
  if(st.length>=2&&parseFloat(st[0].value)>0){
    shrink=(parseFloat(st[st.length-1].value)-parseFloat(st[0].value))/parseFloat(st[0].value);
  }
  const mgrChanged=(d.managerChanges||[]).some(c=>c.to==='至今'&&c.from>(new Date().getFullYear()-1)+'-01-01')||false;
  const stable=/债|货币|FOF|养老|平衡/.test(d.type||'');
  // 核心：稳定类型（固收/FOF/平衡等压舱石）+ 规模>=5亿 + 结论不差 + 经理稳定
  if(stable&&scale>=5&&verdictLabel!=='建议调整'&&!mgrChanged)return'核心配置';
  // 新基金（成立<1年）→ 观察
  let newFund=false;
  if(d.foundDate){
    const fd=new Date(String(d.foundDate).replace(/年/g,'-').replace(/月/g,'-').replace(/日/g,''));
    if(!isNaN(fd)&&(Date.now()-fd.getTime())<365*24*3600*1000)newFund=true;
  }
  // 卫星：结论不差、非新基金、有一定规模（大型主动基金也归卫星，如140亿赛道基金）
  if(verdictLabel!=='建议调整'&&!newFund&&scale>=1)return'卫星配置';
  return'机会型配置';
}

// 六段推荐理由（由已有字段拼接，一事一议基础）
function buildReasons(d,verdict,position){
  const perf=perfMap(d.perf);
  const p1y=perf['近1年'],p3m=perf['近3月'],p2y=perf['近2年'];
  const rm=d.riskMetrics||{};
  const st=d.scaleTrend||[];
  const top3=(d.holdings||[]).slice(0,3).map(h=>h.name).join('、');
  const scaleNow=d.scale||'—';
  const scaleChg=st.length>=2?((parseFloat(st[st.length-1].value)-parseFloat(st[0].value))/parseFloat(st[0].value)*100).toFixed(1):null;
  const mgrChg=(d.managerChanges||[]).filter(c=>c.to==='至今');
  const mgrInfo=mgrChg.length?`${mgrChg[0].name}（${mgrChg[0].from}起，${mgrChg[0].period}）`:(d.currentManager||'未知');
  const posText={核心配置:'组合压舱石：长期业绩底色优秀、规模与经理稳定，作为底仓持有',卫星配置:'组合收益增强仓：赛道/风格特征明确，博取超额收益弹性',机会型配置:'阶段性/观察仓：新基金、规模偏小或趋势待确认，小仓位布局'}[position]||'';

  return{
    '配置定位':`${position}：${posText}。本基金为${d.type||'未知类型'}，${scaleNow}规模${scaleChg?`（近8季度${scaleChg.startsWith('-')?'缩水':'增长'}${Math.abs(scaleChg)}%）`:''}。`,
    '定位与策略':`类型${d.type||'—'}；${d.benchmark?`业绩基准：${d.benchmark}；`:''}${top3?`主要持仓：${top3}。`:''}`,
    '业绩支撑':`近3月${p3m?.收益率||'—'}${p3m?.四分位?`（${p3m.四分位}）`:''}、近1年${p1y?.收益率||'—'}${p1y?.四分位?`（${p1y.四分位}）`:''}、近2年${p2y?.收益率||'—'}${p2y?.四分位?`（${p2y.四分位}）`:''}；判定：${verdict.label}。`,
    '基金经理':`${mgrInfo}${(d.managerChanges||[]).length>1?`；历任经理${(d.managerChanges||[]).length}位`:''}${d.managerProductCount?`；在管${d.managerProductCount}只产品`:''}。`,
    '规模信号':`最新规模${scaleNow}${scaleChg?`；近8季度规模${scaleChg.startsWith('-')?'减少':'增加'}${Math.abs(scaleChg)}%`:''}${position==='机会型配置'?(parseFloat(d.scale)<5?'（规模偏小，需关注清盘线）':''):''}。`,
    '风险提示':`${rm.maxDrawdown?`历史最大回撤${Math.abs(parseFloat(rm.maxDrawdown)).toFixed(1)}%${rm.peakDate?`（${rm.peakDate}~${rm.troughDate||'至今'}）`:''}`:'—'}；${/债|货币/.test(d.type||'')?'固收类产品波动较低，关注利率与信用风险':'权益/主题类产品波动较大，注意仓位控制'}${position==='机会型配置'?'；机会型配置建议小仓试探、设定观察条件':'。'}`,
  };
}

function buildReport(d){
  const mgrChanged=(d.managerChanges||[]).some(c=>c.to==='至今'&&c.from>(new Date().getFullYear()-1)+'-01-01');
  const verdict=calcVerdict(d.perf,mgrChanged);
  const positionLabel=calcPosition(d,verdict.label);
  const pos=POSITION_STYLE[positionLabel];
  const v=VERDICT_STYLE[verdict.label];
  const report={
    verdict:{label:verdict.label,color:v.color,emoji:v.emoji},
    position:{label:positionLabel,color:pos.color,bg:pos.bg,cls:pos.cls},
    reasons:buildReasons(d,verdict,positionLabel),
  };
  return report;
}

module.exports={buildReport,classify};
