// 基金配置工作台 - 服务端入口
const express=require('express');
const app=express();
const PORT=process.env.PORT||3005;
app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));

const auth=require('./lib/auth');
const funddata=require('./lib/funddata');
const fundlist=require('./lib/fundlist');
const rank=require('./lib/rank');
const advice=require('./lib/advice');

// ===== 鉴权（无需登录）=====
app.post('/api/login',(req,res)=>{
  const r=auth.login(req.body?.password,req.ip||req.socket.remoteAddress);
  if(!r.ok)return res.status(r.status).json({error:r.msg});
  res.json({token:r.token});
});
app.post('/api/logout',(req,res)=>{
  const h=req.headers.authorization||'';
  const t=h.startsWith('Bearer ')?h.slice(7):'';
  auth.logout(t);
  res.json({ok:true});
});

// ===== 以下均需登录 =====
app.get('/api/me',auth.requireAuth,(req,res)=>res.json({ok:true}));

app.get('/api/types',auth.requireAuth,async(req,res)=>{
  try{const list=await fundlist.load();res.json({types:fundlist.types(list)});}
  catch(e){res.status(502).json({error:'基金类型加载失败：'+e.message});}
});

app.get('/api/search',auth.requireAuth,async(req,res)=>{
  try{
    const list=await fundlist.load();
    const{q='',type='',page=1,size=30}=req.query;
    const r=fundlist.search(list,q,type,parseInt(page),Math.min(parseInt(size)||30,100));
    res.json(r);
  }catch(e){res.status(502).json({error:'搜索失败：'+e.message});}
});

app.get('/api/rank',auth.requireAuth,async(req,res)=>{
  try{
    const{sc='1nzf',ft='all',page=1,size=100}=req.query;
    const r=await rank.getRank(sc,ft,parseInt(page),Math.min(parseInt(size)||100,200));
    res.json(r);
  }catch(e){res.status(502).json({error:'排名获取失败：'+e.message});}
});

function withReport(d){
  if(!d)return d;
  d.report=advice.buildReport(d);
  return d;
}

app.post('/api/fund',auth.requireAuth,async(req,res)=>{
  const{code}=req.body||{};
  if(!code||!/^\d{6}$/.test(code))return res.status(400).json({error:'请输入6位基金代码'});
  try{
    const d=await funddata.getFund(code);
    res.json(withReport(d));
  }catch(e){
    console.log('Error',code,e.message);
    res.status(500).json({error:'获取数据失败，请检查基金代码是否正确'});
  }
});

app.post('/api/funds',auth.requireAuth,async(req,res)=>{
  const codes=(req.body?.codes||[]).filter(c=>/^\d{6}$/.test(c));
  if(!codes.length)return res.status(400).json({error:'请提供有效的基金代码列表'});
  if(codes.length>12)return res.status(400).json({error:'一次最多生成12只基金'});
  const out=[];
  // 并发限3
  const pool=async(tasks,limit)=>{
    const ret=[];let i=0;
    const worker=async()=>{while(i<tasks.length){const idx=i++;ret[idx]=await tasks[idx]();}};
    const ws=Array.from({length:Math.min(limit,tasks.length)},worker);
    await Promise.all(ws);
    return ret;
  };
  const results=await pool(codes.map(c=>async()=>{
    try{return{code:c,ok:true,data:withReport(await funddata.getFund(c))};}
    catch(e){return{code:c,ok:false,error:'获取失败'};}
  }),3);
  res.json({funds:results});
});

app.listen(PORT,()=>console.log('基金配置工作台 on port',PORT));
