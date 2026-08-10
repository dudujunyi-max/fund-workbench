// 基金列表与筛选：全量基金 + 基金公司 + 8大类（指数/股票/混合/债券/货币/QDII/FOF/商品REITs）
// 数据源：fundcode_search.js（27430只）+ company/default.html（215家基金公司），内存缓存24h
let list=null,companies=null,loadedAt=0,compAt=0;
const TTL=24*3600*1000;
const URL='https://fund.eastmoney.com/js/fundcode_search.js';
const COMP_URL='https://fund.eastmoney.com/company/default.html';

// 天天基金细分类型 -> 用户 8 大类
const CAT_MAP=[
  ['指数型', ['指数型-股票','指数型-固收','指数型-海外股票','指数型-其他']],
  ['股票型', ['股票型']],
  ['混合型', ['混合型-偏股','混合型-偏债','混合型-平衡','混合型-灵活','混合型-绝对收益']],
  ['债券型', ['债券型-中短债','债券型-信用债','债券型-利率债','债券型-混合一级','债券型-混合二级','债券型-长债']],
  ['货币型', ['货币型-普通货币','货币型-浮动净值']],
  ['QDII', ['QDII-普通股票','QDII-混合债','QDII-混合偏股','QDII-混合平衡','QDII-混合灵活','QDII-纯债','QDII-商品','QDII-REITs','QDII-FOF']],
  ['FOF', ['FOF-均衡型','FOF-稳健型','FOF-进取型']],
  ['商品REITs', ['商品','Reits']],
];
const CATS=CAT_MAP.map(x=>x[0]);

function catOf(subtype){
  for(const[cat,subs]of CAT_MAP)if(subs.includes(subtype))return cat;
  return'';
}

async function load(){
  const now=Date.now();
  if(list&&now-loadedAt<TTL)return list;
  const r=await fetch(URL,{signal:AbortSignal.timeout(30000),headers:{Referer:'https://fund.eastmoney.com/'}});
  const text=await r.text();
  const m=text.match(/=\s*(\[.*\])\s*;$/s)||text.match(/=\s*(\[.*\])\s*;/s);
  if(!m)throw new Error('基金列表解析失败');
  const raw=JSON.parse(m[1]);
  list=raw.map(it=>({code:it[0],py:it[1],name:it[2],type:it[3],pinyin:it[4]}));
  loadedAt=now;
  return list;
}

// 基金公司列表（简称）
async function loadCompanies(){
  const now=Date.now();
  if(companies&&now-compAt<TTL)return companies;
  const r=await fetch(COMP_URL,{signal:AbortSignal.timeout(30000),headers:{Referer:'https://fund.eastmoney.com/'}});
  const h=await r.text();
  const seen=new Set();
  const names=[];
  const re=/Company\/(\d{8})\.html[^>]*>([\u4e00-\u9fa5A-Za-z（）()\-]+)</g;
  let m;
  while((m=re.exec(h))!==null){
    const n=cl(m[2]);
    if(n&&!seen.has(n)){seen.add(n);names.push(n);}
  }
  companies=names.sort((a,b)=>b.length-a.length); // 长名优先（"上投摩根"在"上投"前）
  compAt=now;
  return companies;
}
const cl=t=>(t||'').replace(/\s+/g,' ').trim();

// 公司名 -> 匹配前缀核心词："易方达基金管理有限公司"->"易方达"
function companyCore(name){
  return cl(name)
    .replace(/基金管理有限公司/g,'')
    .replace(/基金管理/g,'')
    .replace(/资产管理有限公司/g,'')
    .replace(/资产管理/g,'')
    .replace(/基金销售有限公司/g,'')
    .replace(/有限公司/g,'')
    .replace(/有限责任公司/g,'')
    .replace(/基金/g,'')
    .replace(/股份/g,'');
}

// ===== 全市场增强数据：规模/成立日期/申购状态（来自 rankhandler，懒加载缓存24h） =====
let rankMeta=null,rankAt=0;
const RANK_TTL=24*3600*1000;
const RANK_URL='https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1nzf&st=desc&dx=1';
// 规模/成立时长分档（前端按索引传多选）
const SCALE_BANDS=[[0,1,'<1亿'],[1,5,'1-5亿'],[5,20,'5-20亿'],[20,100,'20-100亿'],[100,Infinity,'>100亿']];
const AGE_BANDS=[[0,1,'<1年'],[1,3,'1-3年'],[3,5,'3-5年'],[5,10,'5-10年'],[10,Infinity,'>10年']];

async function loadRankMeta(){
  const now=Date.now();
  if(rankMeta&&now-rankAt<RANK_TTL)return rankMeta;
  const map=new Map();
  const pageSize=3000;
  try{
    const first=await fetch(RANK_URL+'&pi=1&pn=1',{signal:AbortSignal.timeout(20000),headers:{Referer:'https://fund.eastmoney.com/data/fundranking.html'}});
    const ft=await first.text();
    const total=parseInt((ft.match(/allRecords:(\d+)/)||[])[1])||20074;
    for(let pi=1;pi<=Math.ceil(total/pageSize);pi++){
      let txt='';
      for(let attempt=0;attempt<3;attempt++){
        try{
          const r=await fetch(RANK_URL+'&pi='+pi+'&pn='+pageSize,{signal:AbortSignal.timeout(30000),headers:{Referer:'https://fund.eastmoney.com/data/fundranking.html'}});
          txt=await r.text();
          if(txt.includes('rankData'))break;
        }catch(e){}
        await new Promise(r=>setTimeout(r,500));
      }
      const datas=[...txt.matchAll(/"(\d{6},[^"]+)"/g)].map(m=>m[1]);
      for(const row of datas){
        const f=row.split(',');
        if(f.length<19)continue;
        map.set(f[0],{scale:parseFloat(f[18])||0,foundDate:f[16]||'',buyable:f[17]||'1'});
      }
    }
    rankMeta=map;rankAt=now;
  }catch(e){}
  return map;
}

// 搜索：q 关键词；cats 大类；comps 公司；scales/ages/buyable/currency 增强筛选
async function search(arr,q='',cats='',comps='',page=1,size=30,extra={}){
  q=(q||'').trim().toLowerCase();
  const catArr=(typeof cats==='string'?cats.split(','):(cats||[])).map(s=>s.trim()).filter(Boolean);
  const compArr=(typeof comps==='string'?comps.split(','):(comps||[])).map(s=>s.trim()).filter(Boolean);
  const scArr=String(extra.scales||'').split(',').map(s=>parseInt(s)).filter(n=>!isNaN(n));
  const agArr=String(extra.ages||'').split(',').map(s=>parseInt(s)).filter(n=>!isNaN(n));
  const buyable=extra.buyable||'';
  const currency=extra.currency||'';
  let r=arr;
  if(catArr.length){
    const subSet=new Set();
    for(const c of catArr){
      const subs=(CAT_MAP.find(x=>x[0]===c)||[])[1]||[];
      subs.forEach(s=>subSet.add(s));
    }
    if(subSet.size)r=r.filter(x=>subSet.has(x.type));
  }
  if(compArr.length){
    const cores=compArr.map(companyCore).filter(Boolean);
    if(cores.length)r=r.filter(x=>cores.some(c=>x.name.startsWith(c)));
  }
  if(q){
    r=r.filter(x=>x.name.toLowerCase().includes(q)||x.code.includes(q)||x.pinyin.toLowerCase().includes(q)||x.py.toLowerCase().includes(q));
  }
  // 增强筛选：规模/成立时长/申购状态（需 rankMeta）
  if(scArr.length||agArr.length||buyable){
    let meta=rankMeta;
    if(!meta||Date.now()-rankAt>=RANK_TTL)meta=await loadRankMeta();
    const nowT=Date.now();
    r=r.filter(x=>{
      const m=meta.get(x.code);
      if(!m)return scArr.length===0&&agArr.length===0&&!buyable;
      if(scArr.length){const s=m.scale;if(!scArr.some(i=>s>=SCALE_BANDS[i][0]&&s<SCALE_BANDS[i][1]))return false;}
      if(agArr.length){
        const yrs=(nowT-new Date(m.foundDate).getTime())/(365*24*3600*1000);
        if(isNaN(yrs))return false;
        if(!agArr.some(i=>yrs>=AGE_BANDS[i][0]&&yrs<AGE_BANDS[i][1]))return false;
      }
      if(buyable==='open'&&m.buyable!=='1')return false;
      if(buyable==='closed'&&m.buyable==='1')return false;
      return true;
    });
  }
  // 购买币种筛选（按份额标识精确判断，避免"美元债人民币"误判为美元）
  if(currency){
    r=r.filter(x=>{
      const n=x.name;
      const isCny=/人民币/.test(n);
      const isUsd=!isCny&&(
        /美元现汇|美元现钞|USD/.test(n)||
        /美元$/.test(n.trim())||
        (/美元(?!债)/.test(n)&&!/美元债|人民币/.test(n))
      );
      const isOther=!isCny&&!isUsd&&(
        /港元|港币|HKD|英镑|澳元|加元|日元|新加坡元|新西兰元|瑞士法郎/.test(n)||
        (/现汇|现钞/.test(n))
      );
      if(currency==='usd')return isUsd;
      if(currency==='other')return isOther;
      return isCny; // cny：人民币份额（明确标"人民币"或默认）
    });
  }
  const total=r.length;
  const start=(page-1)*size;
  return{total,list:r.slice(start,start+size).map(x=>({code:x.code,name:x.name,type:x.type,py:x.py}))};
}

module.exports={load,loadCompanies,types:()=>CATS,search,companyCore,CATS,SCALE_BANDS,AGE_BANDS};
