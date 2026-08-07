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

// 搜索：q 匹配名称/拼音/代码；cat 大类；company 公司（前缀匹配）；分页
function search(arr,q='',cat='',company='',page=1,size=30){
  q=(q||'').trim().toLowerCase();
  let r=arr;
  if(cat){
    const subs=CAT_MAP.find(x=>x[0]===cat)?.[1]||[];
    if(subs.length)r=r.filter(x=>subs.includes(x.type));
  }
  if(company){
    const core=companyCore(company);
    if(core)r=r.filter(x=>x.name.startsWith(core));
  }
  if(q){
    r=r.filter(x=>x.name.toLowerCase().includes(q)||x.code.includes(q)||x.pinyin.toLowerCase().includes(q)||x.py.toLowerCase().includes(q));
  }
  const total=r.length;
  const start=(page-1)*size;
  return{total,list:r.slice(start,start+size).map(x=>({code:x.code,name:x.name,type:x.type,py:x.py}))};
}

module.exports={load,loadCompanies,types:()=>CATS,search,companyCore,CATS};
