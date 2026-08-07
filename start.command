#!/bin/bash
# 基金配置工作台 - 一键启动脚本
# 双击运行，或终端执行：./start.command
# 启动后浏览器访问 http://localhost:3005 （口令 icbcdjy）

NODE=/Users/junyi/.workbuddy/binaries/node/versions/22.22.2/bin/node
APP=/Users/junyi/WorkBuddy/2026-08-05-22-00-21/fund-workbench

cd "$APP"
export PASSWORD=icbcdjy

# 若已有服务在跑则直接打开浏览器
if curl -s --noproxy '*' -o /dev/null --max-time 2 http://localhost:3005/login.html 2>/dev/null; then
  echo "✅ 工作台已在运行，正在打开浏览器..."
  open "http://localhost:3005"
  sleep 1
  exit 0
fi

echo "🚀 正在启动基金配置工作台..."
# setsid 方式启动：进程脱离终端会话，终端关闭后依然存活
PY=/Users/junyi/.workbuddy/binaries/python/versions/3.13.12/bin/python3
"$PY" -c "
import os
pid=os.fork()
if pid==0:
    os.setsid()
    os.chdir('$APP')
    env=dict(os.environ); env['PASSWORD']='icbcdjy'
    os.execve('$NODE', ['node','server.js'], env)
"
sleep 2
open "http://localhost:3005"
echo "✅ 已启动，浏览器将打开 http://localhost:3005 （口令 icbcdjy）"
echo "   服务日志：/tmp/fund-workbench.log"
