# CLAUDE.md — swimming3d(游泳・自由式 3D,LA 2028 夏奧皮)

> 2026-07-27 建站:fork 自 speedskating3d(B1 游泳自由式)。核心手感=左右臂交替節奏划水
> (tapPush 判定不動)+★換氣時機(綠窗按 S)+★蹬牆轉身(timeToWall 倒數綠窗按 W);
> 水環境整檔收割 waterpolo3d 的 src/water.js(一字不改)。
> 尚未部署;上架時走 CF Pages(/ship-cf,2026-07-19 鐵則:新站一律 Cloudflare)。

## 引擎核心(換皮時別動的)

- 賽道=50m 直道泳池:`pathPoint(dist, laneZ)`(直線來回,每 50m 一趟、轉身處 tx 翻轉;
  一切以「里程 dist」為域);`nextWallDist(d)`=下一面池壁。水道=絕對 z(P1 中央 0、
  AI +2.5、雙人 P2 −2.5),不用法線偏移(方向會翻,法線偏移會換邊)。
- 節奏划水:`tapPush(racer, side)`——連按同側=划亂(×0.8+短暫無力);gap<0.14s=太急;
  否則 `q = 1 - |gap - ideal|/tol`(speed-race-kit 同款),`applyPush` 收斂到 maxSpeed。
- ★換氣:`breathWindowOpen(r)`=判定=HUD 綠窗同一函式;氣量見底窗常開(溫柔);
  窗內按 S=回滿不掉速,窗外按=嗆水(×0.72+chokeT,不失敗);見底=強制慢速 0.45×。
  幼幼 `assistBreath`=窗開 0.35s 自動換。
- ★轉身:`turnWindowOpen(r)`=timeToWall ≤ preset.turnWindow(skijump 倒數逼近型);
  窗內按 W=`turnArmed`,碰壁瞬間 `resolveTurn`:armed=保速+1.1 加速,錯過=×0.45 慢轉(溫柔)。
- racer 結構 P1/P2/AI 統一(duel-2p-kit §7C):AI=節拍器輸入+換氣/轉身全自動(aiSkill 控品質),
  `_isHuman()` 單閘門;solo 時 P2 鍵(方向鍵)別名回 P1,不變死鍵。
- 泳者階層:node(位置+yaw)> buoy(applyBuoyancy sink=0.55 浮力/隨浪傾斜)> figure.group
  (俯臥 PRONE_ROT=π/2−0.1、PRONE_Y=0.5 補償、PRONE_Z=−1.15 對中)。身體滾轉=rig.rotation.y、
  換氣側頭=headGroup.rotation.y(俯臥後座標系:−x=抬臉)。
- `makePerson`:泳帽=隊色 hood+蛙鏡 goggles(鏡片+環頭帶)+軀幹泳衣/手臂小腿露膚/赤腳;
  臉部鐵則(眼耳嘴眉、耳前無髮)不動。觀眾=便服無蛙鏡。
- 水:src/water.js 整檔來自 waterpolo3d(一字不改)。水面/水道繩/水花/浮力全用同一個
  `waterHeightAt`(判定=畫面的水版)。每幀 `water.update(t)`+`rope.update(t)`+`splash.update(dt,t)`。
- `this.running` 只給 RAF(athletics 撞名事故鐵則——絕不再宣告同名狀態)。
- P1 紅帽、P2 藍帽、AI 綠帽(系列拍板)。

## 本機地雷

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 貼地面片要 `rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `.bat` 純 ASCII+CRLF(PowerShell 寫);run.bat 用 port 5221 避撞。
- msedge-tts 這台偶爾一句就死:gen-voice.mjs 逐句落盤,重跑到「新產 0」即完成。
- 溝通一律繁體中文。

## 驗證

`npm run build`(檢查 dist/ 有真產物)→ `npx vite preview --port 4181` →
`node scripts/verify-swimming.mjs http://localhost:4181 scripts/shots`
(kids 完賽出成績、換氣窗內/窗外按 S、轉身窗蹬牆、鏡頭 NaN、render 非黑圖,
全程 0 pageerror 才綠)。

## 部署

尚未部署。beacon 雙平台版已鋪(index.html `window.psPing`,只擋 localhost;
id=swimming3d,-start/-done 帶 t 秒)。sw.js CACHE_NAME=swimming-nf1,改版要 bump。
