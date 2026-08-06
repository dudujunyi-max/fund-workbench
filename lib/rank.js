// 业绩排名：代理天天基金 rankhandler.aspx（JSONP），缓存30min
const URL='https://fund.eastmoney.com/data/rankhandler.aspx';
const REF='https://fund.eastmoney.com/data/fundranking.html';
const TTL=30*60*1000;
const cache=new Map(); // key -> {t, v}

// sc 参数 -> datas 字段索引（代码,名称,拼音,日期,单位净值,累计净值,日涨,近1周,近1月,近3月,近6月,近1年,近2年,近3年,今年来,...）
const SC_IDX={ '1yzf':8,'3yzf':9,'6yzf':10,'1nzf':11,'2nzf':12,'3nzf':13,'jnzf':14 };

async function getRank(sc='1nzf',ft='all',page=1,size=100){
  const key=`${sc}|${ft}|${page}|${size}`;
  const hit=cache.get(key);
  if(hit&&Date.now()-hit.t<TTL)return hit.v;
  const url=`${URL}?op=ph&dt=kf&ft=${ft}&rs=&gs=0&sc=${sc}&st=desc&pi=${page}&pn=${size}&dx=1&v=${Date.now()}`;
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Referer:REF}});
  const text=await r.text();
  const m=text.match(/var rankData\s*=\s*(\{[\s\S]*?\});/);
  if(!m)throw new Error('排名数据解析失败');
  // rankhandler 返回非标准 JSON（key 无引号），提取 datas 数组单独解析
  const dm=text.match(/datas:\s*(\[.*?\]),\s*allRecords/s);
  const datas=dm?JSON.parse(dm[1]):[];
  const allNum=parseInt((text.match(/allNum:\s*(\d+)/)||[])[1])||0;
  const pageIndex=parseInt((text.match(/pageIndex:\s*(\d+)/)||[])[1])||1;
  const pageNum=parseInt((text.match(/pageNum:\s*(\d+)/)||[])[1])||0;
  const idx=SC_IDX[sc]!==undefined?SC_IDX[sc]:11;
  const list=datas.map((row,i)=>{
    const f=row.split(',');
    return{
      code:f[0],name:f[1],
      returns:f[idx]||'—',
      rank:(pageIndex-1)*pageNum+i+1,   // 该窗口降序排序下的名次
    };
  });
  const v={allNum,list};
  cache.set(key,{t:Date.now(),v});
  return v;
}

module.exports={getRank};
