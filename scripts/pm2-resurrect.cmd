@echo off
rem Restores the saved pm2 process list (pf-bot, pf-analyst, pf-dashboard) after login or boot.
cd /d D:\pumpfun
"C:\nvm4w\nodejs\node.exe" "D:\pumpfun\node_modules\pm2\bin\pm2" resurrect >> "D:\pumpfun\scripts\pm2-boot.log" 2>&1
