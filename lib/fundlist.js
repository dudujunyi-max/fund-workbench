// 基金列表：拉取天天基金 fundcode_search.js（27430只），内存缓存24h，提供搜索与类型
let list=null,loadedAt=0;
const TTL=24*3600*1000;
const URL='https://fund.eastmoney.com/js/fundcode_search.js';

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

function types(list){return[...new Set(list.map(x=>x.type).filter(Boolean))].sort();}

// 搜索：q 匹配名称/拼音/代码；type 精确匹配；分页
function search(arr,q='',type='',page=1,size=30){
  q=(q||'').trim().toLowerCase();
  let r=arr;
  if(q){
    r=r.filter(x=>x.name.toLowerCase().includes(q)||x.code.includes(q)||x.pinyin.toLowerCase().includes(q)||x.py.toLowerCase().includes(q));
  }
  if(type)r=r.filter(x=>x.type===type);
  const total=r.length;
  const start=(page-1)*size;
  return{total,list:r.slice(start,start+size).map(x=>({code:x.code,name:x.name,type:x.type,py:x.py}))};
}

module.exports={load,types,search};
