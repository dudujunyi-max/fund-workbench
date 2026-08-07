// 鉴权：单一共享口令 + 内存 token + IP 防爆破
const crypto=require('crypto');
const PASSWORD=process.env.PASSWORD||'icbcdjy'; // 未配置时使用默认口令（部署到公网务必用环境变量 PASSWORD 单独设置）
const TOKEN_TTL=12*3600*1000;    // 12h
const FAIL_WINDOW=10*60*1000;    // 10min
const FAIL_LIMIT=5;              // 5 次失败

const tokens=new Map();          // token -> {exp}
const fails=new Map();           // ip -> {count, ts}

function safeEqual(a,b){
  const ba=Buffer.from(String(a)),bb=Buffer.from(String(b));
  if(ba.length!==bb.length)return false;
  return crypto.timingSafeEqual(ba,bb);
}

function isBlocked(ip){
  const f=fails.get(ip);
  if(!f)return false;
  if(Date.now()-f.ts>FAIL_WINDOW){fails.delete(ip);return false;}
  return f.count>=FAIL_LIMIT;
}
function recordFail(ip){
  const f=fails.get(ip)||{count:0,ts:Date.now()};
  if(Date.now()-f.ts>FAIL_WINDOW){f.count=0;f.ts=Date.now();}
  f.count++;fails.set(ip,f);
}
function clearFail(ip){fails.delete(ip);}

function login(password,ip){
  if(isBlocked(ip))return{ok:false,status:429,msg:'尝试过于频繁，请10分钟后再试'};
  if(!password||!safeEqual(password,PASSWORD)){recordFail(ip);return{ok:false,status:401,msg:'口令错误'};}
  clearFail(ip);
  const token=crypto.randomBytes(32).toString('hex');
  tokens.set(token,{exp:Date.now()+TOKEN_TTL});
  return{ok:true,token};
}

function logout(token){tokens.delete(token);}

function requireAuth(req,res,next){
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  const t=tokens.get(token);
  if(!t||t.exp<Date.now()){tokens.delete(token);return res.status(401).json({error:'未登录或登录已过期'});}
  req.token=token;
  next();
}

// 清理过期 token（防内存膨胀）
setInterval(()=>{
  const now=Date.now();
  for(const[k,v]of tokens)if(v.exp<now)tokens.delete(k);
},60*60*1000);

module.exports={login,logout,requireAuth};
