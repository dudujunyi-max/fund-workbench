const cheerio=require('cheerio');
const F10='https://fundf10.eastmoney.com',MAIN='https://fund.eastmoney.com';
const cl=t=>(t||'').replace(/\s+/g,' ').trim();
const g=(p,s,bt)=>{const i=bt.indexOf(p);if(i<0)return'';return cl(bt.substring(i+p.length,s?bt.indexOf(s,i+p.length):undefined))};
const fet=async(u,m,ref)=>{const r=await fetch(u,{signal:AbortSignal.timeout(m),headers:ref?{Referer:ref}:{}});return r.text();};

// F10 数据接口（gmbd/jjcc）：返回 var xxx_apidata={content:"HTML"}，失败自动重试2次
async function f10Api(type,code,extra=''){
  const page=type==='gmbd'?'gmbd':'ccmx';
  for(let attempt=0;attempt<3;attempt++){
    try{
      const u=F10+'/FundArchivesDatas.aspx?type='+type+'&code='+code+extra+'&rt='+Date.now();
      const txt=await fet(u,8000,F10+'/'+page+'_'+code+'.html');
      const m=txt.match(/=\s*(\{\s*content:[\s\S]*?\})\s*;?\s*$/);
      if(!m)throw new Error('regex miss');
      const obj=new Function('return '+m[1])();
      if(obj&&obj.content)return obj.content;
    }catch(e){}
    if(attempt<2)await new Promise(r=>setTimeout(r,400+attempt*400));
  }
  return null;
}
// 最近已披露季度（用于 jjcc）
function lastQuarter(){
  const d=new Date();let y=d.getFullYear(),m=d.getMonth()+1;
  const qm=[3,6,9,12].filter(x=>x<m).pop();
  if(qm===undefined){y--;qm=12;}
  return{year:y,month:qm};
}
// 单基金详情缓存：6小时（防数据陈旧）
const cache={};const CACHE_TTL=6*3600*1000;
function cacheGet(k){const c=cache[k];if(c&&Date.now()-c.t<CACHE_TTL)return c.v;return null;}
function cacheSet(k,v){cache[k]={v,t:Date.now()};}

async function fetchAll(code){
  const R={};
  // 1. Main page
  const html=await fet(MAIN+'/'+code+'.html',12000);
  const $=cheerio.load(html);const text=$('body').text().replace(/\s+/g,' ');
  R.name=$('.fundDetail-tit').first().text().trim()||code;
  R.nav=(text.match(/单位净值[（(].*?[）)][：:]?\s*([\d.]+)/)||[])[1]||'';
  R.navChange=(text.match(/单位净值[（(].*?[）)][：:]?\s*[\d.]+\s*\(([+-]?[\d.]+)%\)/)||[])[1]||'';
  R.type=cl((text.match(/类型[：:]\s*([^\s]+)/)||[])[1]||'');
  const sr=text.match(/规模[：:]\s*([\d.]+)\s*亿元/);R.scale=sr?sr[1]+'亿元':'';
  const sd=text.match(/规模[：:]\s*[\d.]+\s*亿元[（(]([\d-]+)[）)]/);R.scaleDate=sd?sd[1]:'';
  R.foundDate=((text.match(/(\d{4}年\d{2}月\d{2}日)/)||[])[1]||(text.match(/成\s*立\s*日[：:]\s*([\d-]+)/)||[])[1]||'');
  // 2. 阶段涨幅
  const perf=[];const ps=['近1周','近1月','近3月','近6月','今年来','近1年','近2年','近3年'];
  const a='近1周近1月近3月近6月今年来近1年近2年近3年 阶段涨幅';
  let pi=text.indexOf(a);if(pi<0){const f=text.indexOf('阶段涨幅');if(f>=0)pi=text.indexOf('阶段涨幅',f+10);}if(pi<0)pi=text.indexOf('阶段涨幅');
  const pE=text.indexOf('同类平均',pi);const pS=pE>pi?text.substring(pi,pE+2000):text.substring(pi,pi+3000);
  const pcts=pS.match(/[-+]?[\d.]+%/g);if(pcts&&pcts.length>=8)ps.forEach((p,i)=>perf.push({period:p,returns:pcts[i]}));
  if(perf.length){
    const aS=pS.substring(pS.indexOf('同类平均'));const aP=aS.match(/[-+]?[\d.]+%/g);if(aP&&aP.length>=8)perf.forEach((p,i)=>{if(aP[i])p.avg=aP[i];});
    const rS=pS.substring(pS.indexOf('同类排名'));const rM=rS.match(/(\d+)\s*\|\s*(\d+)/g);if(rM)rM.slice(0,8).forEach((r,i)=>{if(perf[i])perf[i].rank=r.replace(/\s+/g,'');});
    const qV=[];for(const q of['优秀','良好','一般','不佳']){let idx=-1;while((idx=pS.indexOf(q,idx+1))!==-1)qV.push({idx,val:q});}
    qV.sort((a,b)=>a.idx-b.idx);const t=qV.slice(2,10);if(t.length===8)t.forEach((x,i)=>{if(perf[i])perf[i].quartile=x.val;});
  }
  R.perf=perf;
  // 3. 持仓（优先 F10 jjcc 接口，fallback 主页面解析）
  const holdings=[];let holdQuarter='';
  try{
    const q=lastQuarter();
    const content=await f10Api('jjcc',code,'&topline=10&year='+q.year+'&month='+q.month);
    if(content){
      const qm=(content.match(/(\d{4}年\d{1,2}季度)/)||[])[1]||'';
      const $h=cheerio.load(content);
      $h('table tbody tr').each((i,tr)=>{
        const tds=$h(tr).find('td');
        if(tds.length>=7){
          const name=$h(tds.eq(2)).text().trim();
          const ccode=$h(tds.eq(1)).text().trim();
          const pct=parseFloat($h(tds.eq(6)).text())||0;
          // 过滤债券/非股票名（纯数字代码、英文代码如 PERP）
          if(name&&/[\u4e00-\u9fa5]/.test(name)&&name.length>=2&&pct>0&&pct<100)holdings.push({name,pct,code:ccode});
        }
      });
      holdQuarter=qm;
    }
  }catch(e){}
  if(!holdings.length){
    const hI=html.indexOf('股票持仓');const hI2=hI<0?html.indexOf('基金持仓'):hI;
    if(hI2>=0){const hT=cheerio.load(html.substring(Math.max(0,hI2),hI2+5000)).text().replace(/\s+/g,' ');const hR=/([\u4e00-\u9fa5A-Za-z0-9()（）【】、\-.]+?)\s+([\d.]+)%/g;let m;while((m=hR.exec(hT))!==null){const n=m[1].trim(),p=parseFloat(m[2]);if(n.length>=2&&/[\u4e00-\u9fa5]/.test(n)&&p>0&&p<100&&!['基金名称','持仓占比','股票名称','涨跌幅','相关资讯'].includes(n))holdings.push({name:n,pct:p});}}
  }
  const dedup=[],seen=new Set();holdings.forEach(h=>{if(!seen.has(h.name)){seen.add(h.name);dedup.push(h);}});R.holdings=dedup.slice(0,10);R.holdQuarter=holdQuarter;
  // 4. 持仓分类
  let ep=0,fp=0;for(const h of dedup.slice(0,10)){const ie=h.name.includes('混合')||h.name.includes('股票')||h.name.includes('成长')||h.name.includes('价值')||h.name.includes('ETF')||h.name.includes('指数')||h.name.includes('货币');const fi=h.name.includes('债')||h.name.includes('短融')||h.name.includes('纯债')||h.name.includes('利率')||h.name.includes('信用')||h.name.includes('国开');if(ie)ep+=h.pct;if(fi)fp+=h.pct;}
  R.hc={equityPct:+(ep).toFixed(1),fixedIncomePct:+(fp).toFixed(1)};
  // 5. 经理变更
  const managers=[];const mi=text.indexOf('任职时间');if(mi>0){const mT=text.substring(mi,mi+1000);const mR=/(\d{4}-\d{2}-\d{2})\s*~\s*(至今|\d{4}-\d{2}-\d{2})\s*([^\d]+?)\s+(\d+年又\d+天|\d+天)/g;let m;while((m=mR.exec(mT))!==null)managers.push({from:m[1],to:m[2],name:cl(m[3]),period:m[4]});}
  R.managerChanges=managers;R.currentManager=managers.length>0?managers[0].name:'';R.managerStartDate=managers.length>0?managers[0].from:'';
  // 6. jbgk (费率/托管人/基准)
  try{const bh=await fet(F10+'/jbgk_'+code+'.html',6000);const b$=cheerio.load(bh);const bt=b$('body').text().replace(/\s+/g,' ');
    if(!R.type)R.type=cl(b$('td:contains("基金类型")').next('td').text())||g('基金类型','发行日期',bt);
    R.managerName=cl(b$('td:contains("基金管理人")').next('td').text())||g('基金管理人','基金托管人',bt);
    R.custodian=cl(b$('td:contains("基金托管人")').next('td').text())||'';
    R.mgmtFee=cl(b$('td:contains("管理费率")').next('td').text())||g('管理费率','（每年）',bt)+'（每年）';
    R.custodyFee=cl(b$('td:contains("托管费率")').next('td').text())||g('托管费率','（每年）',bt)+'（每年）';
    R.serviceFee=cl(b$('td:contains("销售服务费率")').next('td').text())||'无';
    R.buyFee=cl(b$('td:contains("最高申购费率")').next('td').text())||g('最高申购费率','（前端）',bt)+'（前端）';
    R.redeemFee=cl(b$('td:contains("赎回费率")').next('td').text())||'—';
    R.benchmark=cl(b$('td:contains("业绩比较基准")').next('td').text())||'';
    if(!R.scale){const sr2=bt.match(/净资产规模[：:]\s*([\d.]+)/);if(sr2)R.scale=sr2[1]+'亿元';}
    if(!R.scaleDate){const sd2=bt.match(/截止[至于][：:]?\s*([\d-]+)/);if(sd2)R.scaleDate=sd2[1];}
  }catch(e){}
  // 7. jjjl (经理详情)
  try{const mh=await fet(F10+'/jjjl_'+code+'.html',6000);const m$=cheerio.load(mh);const mt=m$('body').text();
    if(!R.currentManager)R.currentManager=(mt.match(/姓名[：:]\s*([\u4e00-\u9fa5]{2,4})(?:上任|先生|女士|\s|）)/)||[])[1]||'';
    if(!R.managerStartDate)R.managerStartDate=(mt.match(/上任日期[：:]\s*([\d-]+)/)||[])[1]||'';
    R.productCount=(mh.match(/基金代码/g)||[]).length||0; // 历任基金一览表格行数（含表头），防回溯
  }catch(e){}
  // 8. pingzhongdata (全量NAV趋势)
  let navTrend=[];try{const pj=await fet(MAIN+'/pingzhongdata/'+code+'.js',6000);const m=pj.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);if(m)navTrend=JSON.parse(m[1]);}catch(e){}
  // 9. gmbd (规模趋势，F10 接口优先，fallback 页面正则)
  let st=[];try{
    const content=await f10Api('gmbd',code);
    if(content){
      const $h=cheerio.load(content);
      $h('table tbody tr').each((i,tr)=>{
        const tds=$h(tr).find('td');
        if(tds.length>=5){
          const date=$h(tds.eq(0)).text().trim();
          const val=parseFloat($h(tds.eq(4)).text());
          if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!isNaN(val))st.push({date,value:val});
        }
      });
    }
  }catch(e){}
  if(!st.length){try{const sh=await fet(F10+'/gmbd_'+code+'.html',6000);const sr2=/(\d{4}-\d{2}-\d{2})[\s\S]{0,200}?期末净资产[（(]亿元[）)][\s\S]{0,30}?([\d.]+)/g;let m;while((m=sr2.exec(sh.replace(/\n/g,' ')))!==null)st.push({date:m[1],value:parseFloat(m[2])});}catch(e){}}
  // 10. 计算最大回撤
  const calcDD=(nt)=>{if(!nt||nt.length<20)return{md:null,rd:null,ds:[]};
    const d=nt.map(x=>({t:x.x,nav:x.y}));let peak=d[0].nav,peakT=d[0].t,md=0,troughT=null,ds=[];
    for(const x of d){
      if(x.nav>peak){peak=x.nav;peakT=x.t;}
      const dd=(x.nav-peak)/peak;ds.push({t:x.t,dd:+((dd*100).toFixed(2))});
      if(Math.abs(dd)>md){md=Math.abs(dd);troughT=x.t;}
    }
    let rd=null;if(troughT){for(const x of d.filter(x=>x.t>=troughT)){if(x.nav>=peak){rd=Math.round((x.t-troughT)/(24*60*60*1000));break;}}}
    const fmt=d=>new Date(d).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
    return{md:md>0?'-'+(md*100).toFixed(2):'0.00',rd,ds,peakDate:fmt(peakT),troughDate:fmt(troughT)};
  };
  const rm=calcDD(navTrend);
  // 11. 逐周期最大回撤
  const calcPDD=(nt,pf)=>{if(!nt||nt.length<30||!pf.length)return pf;
    const lb={'近1周':7,'近1月':30,'近3月':90,'近6月':180,'今年来':Math.floor((Date.now()-new Date(new Date().getFullYear(),0,1).getTime())/(24*3600*1000)),'近1年':365,'近2年':730,'近3年':1095};
    const data=nt.map(x=>({t:x.x,nav:x.y}));const today=nt[nt.length-1].x;
    return pf.map(p=>{const days=lb[p.period]||90;const cut=today-days*24*3600*1000;const seg=data.filter(x=>x.t>=cut);if(seg.length<5)return{...p,periodDd:'—'};let peak=seg[0].nav,pdd=0;for(const x of seg){if(x.nav>peak)peak=x.nav;const dd=(peak-x.nav)/peak;if(dd>pdd)pdd=dd;}return{...p,periodDd:pdd>0?'-'+(pdd*100).toFixed(2)+'%':'-0.00%'};});};
  const perfDd=calcPDD(navTrend,perf);
  // 12. 配置建议
  const t3=dedup.slice(0,3).map(h=>h.name).join('、');
  const t3p=dedup.slice(0,3).reduce((s,h)=>s+h.pct,0).toFixed(1);
  const cfg=`${R.name||code}（${code}）作为${R.type||'未知'}基金`+
    (ep>0||fp>0?`，权益${ep.toFixed(1)}%·固收${fp.toFixed(1)}%`:'')+
    (dedup.length>0?`。前三大${t3}，合计${t3p}%。`:'。')+
    (R.currentManager?`基金经理${R.currentManager}。`:'')+
    (rm.md?`历史最大回撤${Math.abs(parseFloat(rm.md)).toFixed(1)}%。`:'')+
    `适合作为组合中的${R.type?.includes('稳健')||R.type?.includes('FOF')?'稳健配置':R.type?.includes('债券')?'固收底仓':'策略配置'}部分。`;
  // 13. 返回
  return {code,name:R.name||code,type:R.type||'',foundDate:R.foundDate||'',
    mgmtFee:R.mgmtFee||'',custodyFee:R.custodyFee||'',serviceFee:R.serviceFee||'',buyFee:R.buyFee||'',redeemFee:R.redeemFee||'',
    scale:R.scale||'',scaleDate:R.scaleDate||'',benchmark:R.benchmark||'',custodian:R.custodian||'',
    managerName:R.managerName||'',currentManager:R.currentManager||'',managerStartDate:R.managerStartDate||'',
    managerProductCount:R.productCount||0,managerChanges:R.managerChanges||[],
    holdings:R.holdings||[],holdingsClassified:R.hc||{},perf:perfDd,
    riskMetrics:{maxDrawdown:rm.md,recoveryDays:rm.rd,peakDate:rm.peakDate,troughDate:rm.troughDate},
    navTrend,scaleTrend:st.sort((a,b)=>a.date<b.date?-1:1).slice(-8),configAdvice:cfg};
}

// 带缓存入口：POST /api/fund 与 /api/funds 共用；关键数据缺失时重试并避免缓存残缺结果
async function getFund(code){
  const hit=cacheGet(code);
  if(hit)return hit;
  const d=await fetchAll(code);
  const hasKey=d.navTrend&&d.navTrend.length>5;
  const hasScale=d.scaleTrend&&d.scaleTrend.length>0;
  if(hasKey&&!hasScale){
    try{
      const d2=await fetchAll(code);
      if(d2.scaleTrend&&d2.scaleTrend.length){cacheSet(code,d2);return d2;}
    }catch(e){}
  }
  cacheSet(code,d);
  return d;
}

module.exports={getFund,fetchAll};
