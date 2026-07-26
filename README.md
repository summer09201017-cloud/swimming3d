# 游泳(自由式)3D(swimming3d)

> HFPC 3D 系列 B1(2026-07-27,fork 自 speedskating3d 競速引擎+收割 waterpolo3d water.js)
> ——50m 直道泳池直線來回 100m,核心手感=**左右臂交替節奏划水**(tapPush 判定不動)
> +**★換氣時機**(綠窗按 S)+**★蹬牆轉身**(近池壁綠窗按 W)。LA 2028 夏奧皮;
> 含同機雙人(duel-2p-kit §7C 競速型)。

## 玩法

- **單人競速**:跟 AI 選手隔壁水道對決,50m 來回 2 趟(100m),先觸壁的贏。
- **雙人同機**:P1(紅帽)=A/D 划水+S 換氣+W 轉身;P2(藍帽)=←/→+↓+↑,各一水道。
- **練習池**:無對手、無限趟,自由練節奏/換氣/轉身。

左右**交替**按鍵=雙臂划水:交替且節奏穩=越游越快;連按同側或太急=划亂減速(溫柔,
不失敗、永遠游得完)。**★換氣**:氣量緩慢下降,每隔幾秒 HUD 出現綠色換氣窗——窗內按 S
=側頭換氣(回滿、不掉速);窗外按=嗆水(短暫減速);氣量見底=強制慢速直到成功換氣
(見底時窗常開,一定換得到)。**★轉身**:接近池壁出現綠窗(倒數逼近型),窗內按 W=
蹬牆轉身(保速+小加速);錯過=手碰壁慢轉(只掉速)。
單人模式方向鍵是 P1 的別名(沒有死鍵);平板點畫面=自動左右交替划。

- 五難度:幼兒(氣掉更慢+窗更寬+自動換氣+AI 慢)→ 職業(窗窄+AI 快)。
- P1 紅帽、P2 藍帽、AI 綠帽;泳帽/蛙鏡/俯臥泳姿照 3d-figure-kit 鐵則;
  水面/浮力/水花=water-kit(src/water.js 整檔收割自 waterpolo3d)。

## 開發

```bash
npm install
npm run dev          # 本機開發(或雙擊 run.bat,port 5221)
npm run build        # 產 dist/
npx vite preview --port 4181
node scripts/verify-swimming.mjs http://localhost:4181 scripts/shots  # Playwright 驗證
node scripts/gen-voice.mjs   # 烤播報人聲(雲哲;或雙擊 gen-voice.bat)
```
