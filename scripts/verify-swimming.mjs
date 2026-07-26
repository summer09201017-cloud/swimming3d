// swimming3d 端到端驗證(Playwright)——照任務規格逐項:
// ①選難度開賽→模擬節奏按鍵(A/D 交替+W 轉身)游完全程(用 window.__game 後門加速)→能完賽出成績
// ②Number.isFinite(camera.position.x)(比賽中+選單期各驗一次;NaN 鏡頭中毒鐵則)
// ③同一 evaluate 內先 g.update(0.016)+g.render() 再 canvas.toDataURL 非黑圖
// ④換氣窗內按 S=氣量回滿不掉速;窗外按 S=嗆水(掉速+chokeT>0,溫柔不失敗)
// ⑤選單期鏡頭無 NaN(回首頁後再驗)
// 附加:轉身窗內按 W=蹬牆保速加速;錯過=慢轉(溫柔);雙人模式兩人都會動。
// 全程 0 pageerror 才綠;截圖存 <outDir>/。
// 用法:node scripts/verify-swimming.mjs <url> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("用法:node scripts/verify-swimming.mjs <url> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const EXE = process.env.CHROME_EXE ||
  "C:/Users/HFP/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront(); // 背景分頁 RAF 1fps 像凍結(3d-figure-kit 鐵則)
await page.waitForTimeout(1500);

const G = "__swimming3d";

// ⑤-a 選單期鏡頭無 NaN(開頁即選單,render 迴圈已跑)
results.menuCamFinite = await page.evaluate((g) => {
  const game = window[g];
  return Number.isFinite(game.camera.position.x) && Number.isFinite(game.camera.position.y) && Number.isFinite(game.camera.position.z);
}, G);
await page.screenshot({ path: outDir + "/ss-menu.png" });

const openMode = async (mode, difficulty) => {
  await page.evaluate(() => {
    const home = document.querySelector("#homeScreen");
    if (!home.classList.contains("visible")) document.querySelector("#overlayMenuButton")?.click();
  });
  await page.waitForTimeout(300);
  if (difficulty) await page.selectOption("#menuDifficultySelect", difficulty);
  await page.click(`.mode-card[data-mode="${mode}"]`);
  await page.click("#startMatchButton");
  await page.waitForTimeout(400);
};

// 真按鍵左右交替划(P1=A/D);同拍可帶 P2(←/→)
const strokeTaps = async (taps, gapMs, withP2 = false) => {
  for (let i = 0; i < taps; i += 1) {
    await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
    if (withP2) await page.keyboard.press(i % 2 === 0 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(gapMs);
  }
};

const snap = () => page.evaluate((g) => {
  const game = window[g];
  return {
    phase: game.phase,
    p1: {
      dist: Math.round(game.p1.dist * 10) / 10,
      speed: Math.round(game.p1.speed * 100) / 100,
      lap: game.p1.lap,
      rhythm: Math.round(game.p1.rhythm01 * 100) / 100,
      air: Math.round(game.p1.air * 100) / 100,
    },
    opp: { dist: Math.round(game.opp.dist * 10) / 10, speed: Math.round(game.opp.speed * 100) / 100, visible: game.opp.node.visible },
    overlay: { visible: game.overlay.visible, title: game.overlay.title, eyebrow: game.overlay.eyebrow },
  };
}, G);

// —— ①標準難度開賽:出發→真按鍵划→速度應起來 ——
await openMode("race", "normal");
await page.keyboard.press("Space"); // 出發
await page.waitForTimeout(200);
await strokeTaps(12, 380);
results.normalSwimming = await snap();
await page.screenshot({ path: outDir + "/ss-race-normal.png" });

// —— ② 比賽中鏡頭有限值 + ③ 同一 evaluate:update+render 後 toDataURL 非黑圖 ——
const renderCheck = await page.evaluate((g) => {
  const game = window[g];
  game.update(0.016);
  game.render();
  const canvas = game.canvas;
  const data = canvas.toDataURL("image/png");
  // 抽樣画素:縮到 8x8 看是否全黑
  const c2 = document.createElement("canvas");
  c2.width = 8; c2.height = 8;
  const ctx = c2.getContext("2d");
  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      resolve({
        camFinite: Number.isFinite(game.camera.position.x),
        dataLen: data.length,
        pixelSum: sum,
        notBlack: sum > 2000,
      });
    };
    img.src = data;
  });
}, G);
results.renderCheck = renderCheck;

// —— ④換氣機制:窗外按 S=嗆水(掉速+chokeT>0);窗內按 S=氣量回滿不掉速 ——
// 先把氣量壓低+把週期撥到窗外 → 按 S → 應嗆水
const chokeTest = await page.evaluate((g) => {
  const game = window[g];
  const r = game.p1;
  r.air = 0.5;
  r.breathCycleT = 0.2; // 週期剛開始=窗外
  r.chokeT = 0;
  const speedBefore = r.speed;
  const windowOpenBefore = game.breathWindowOpen(r);
  game.pressBreath(r);
  return {
    windowOpenBefore,
    speedBefore: Math.round(speedBefore * 100) / 100,
    speedAfter: Math.round(r.speed * 100) / 100,
    choked: r.chokeT > 0,
    airAfter: Math.round(r.air * 100) / 100,
    phase: game.phase, // 溫柔:嗆水不改變 phase
  };
}, G);
results.chokeTest = chokeTest;
await page.screenshot({ path: outDir + "/ss-choke.png" });

// 窗內按 S:把週期撥進綠窗 → 按 S → 氣量回滿、速度不掉
const breathTest = await page.evaluate((g) => {
  const game = window[g];
  const r = game.p1;
  const preset = { kids: 0, dummy: 0 };
  void preset;
  const P = game.constructor ? null : null;
  void P;
  r.air = 0.4;
  r.chokeT = 0;
  // 直接把週期撥到窗中央(breathEvery 由 HUD 判定函式讀 preset,不用硬编碼:掃到窗開為止)
  for (let t = 0; t < 12; t += 0.05) {
    r.breathCycleT = t;
    if (game.breathWindowOpen(r)) break;
  }
  const windowOpen = game.breathWindowOpen(r);
  const speedBefore = r.speed;
  game.pressBreath(r);
  return {
    windowOpen,
    speedBefore: Math.round(speedBefore * 100) / 100,
    speedAfter: Math.round(r.speed * 100) / 100,
    airAfter: Math.round(r.air * 100) / 100,
    breathAnim: r.breathAnimT > 0,
  };
}, G);
results.breathTest = breathTest;
await page.screenshot({ path: outDir + "/ss-breath.png" });

// —— 轉身機制:傳到離牆 3m,划到窗開按 W=armed;碰壁=保速+加速 ——
const turnTest = await page.evaluate((g) => {
  const game = window[g];
  const r = game.p1;
  r.dist = 48.2; // 離第一面牆 1.8m,速度 3.2 → timeToWall≈0.56s,穩在 normal 檔 0.85s 窗內(不押邊界)
  r.speed = 3.2;
  r.air = 1;
  const windowOpen = game.turnWindowOpen(r);
  game.pressTurn(r);
  return { windowOpen, armed: r.turnArmed };
}, G);
results.turnArm = turnTest;
// 让它游過牆(真按鍵繼續踩節奏)
await strokeTaps(6, 380);
const afterTurn = await page.evaluate((g) => {
  const game = window[g];
  const r = game.p1;
  return { dist: Math.round(r.dist * 10) / 10, lap: r.lap, speed: Math.round(r.speed * 100) / 100, yawFlipped: Math.abs(game.p1.node.rotation.y - Math.atan2(-1, 0)) < 0.01 };
}, G);
results.afterTurn = afterTurn;
await page.screenshot({ path: outDir + "/ss-turn.png" });

// —— ①完賽:傳到終點前 8m,持續踩節奏+窗內換氣到觸壁 → 應出成績 overlay ——
await page.evaluate((g) => {
  const game = window[g];
  game.p1.dist = game.finishDist - 8;
  game.p1.air = 1;
  game.opp.dist = game.finishDist - 40; // 確保 P1 先觸壁
}, G);
for (let i = 0; i < 24; i += 1) {
  await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
  await page.waitForTimeout(360);
  const s = await page.evaluate((g) => window[g].phase, G);
  if (s === "ended") break;
}
await page.waitForTimeout(600);
results.finish = await snap();
await page.screenshot({ path: outDir + "/ss-finish.png" });

// —— 雙人同機:P1+P2 都划,各自有速度 ——
await openMode("duel2p", "kids");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await strokeTaps(10, 400, true);
results.duelSwimming = await snap();
await page.screenshot({ path: outDir + "/ss-duel.png" });

// —— 練習池:錯過轉身=慢轉(溫柔,phase 不變) ——
await openMode("practice", "normal");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await strokeTaps(8, 380);
const beforeMissTurn = await page.evaluate((g) => {
  const game = window[g];
  game.p1.dist = 48.5;
  game.p1.speed = 3.4;
  game.p1.turnArmed = false;
  return game.p1.speed;
}, G);
await strokeTaps(5, 380);
const missTurn = await page.evaluate((g) => {
  const game = window[g];
  return { dist: Math.round(game.p1.dist * 10) / 10, speed: Math.round(game.p1.speed * 100) / 100, phase: game.phase, turnSlowSeen: game.p1.turnSlowT >= 0 };
}, G);
results.missTurn = { before: Math.round(beforeMissTurn * 100) / 100, ...missTurn };
await page.screenshot({ path: outDir + "/ss-practice.png" });

// —— ⑤-b 回首頁選單:選單期鏡頭再驗 NaN(繞了一場之後) ——
await page.evaluate(() => document.querySelector("#menuButton").click());
await page.waitForTimeout(1200);
results.menuCamFiniteAfter = await page.evaluate((g) => {
  const game = window[g];
  return game.phase === "menu" && Number.isFinite(game.camera.position.x) && Number.isFinite(game.camera.position.y) && Number.isFinite(game.camera.position.z);
}, G);
await page.screenshot({ path: outDir + "/ss-menu-after.png" });

// —— 驗收判定 ——
const checks = {
  // ⑤ 選單期鏡頭無 NaN(開頁+賽後)
  menuCamNoNaN: results.menuCamFinite === true && results.menuCamFiniteAfter === true,
  // 節奏划水:速度起得來
  normalSpeedUp: results.normalSwimming.p1.speed > 1.5,
  aiMoves: results.normalSwimming.opp.speed > 1.5,
  // ② 比賽中鏡頭有限值 ③ render 非黑圖
  raceCamFinite: results.renderCheck.camFinite === true,
  renderNotBlack: results.renderCheck.notBlack === true,
  // ④ 窗外按=嗆水掉速(溫柔:phase 仍 swimming);窗內按=回滿不掉速
  chokeOnBadBreath: results.chokeTest.windowOpenBefore === false && results.chokeTest.choked === true
    && results.chokeTest.speedAfter < results.chokeTest.speedBefore && results.chokeTest.phase === "swimming",
  breathRefills: results.breathTest.windowOpen === true && results.breathTest.airAfter === 1
    && results.breathTest.speedAfter >= results.breathTest.speedBefore - 0.01 && results.breathTest.breathAnim === true,
  // 轉身:窗內按=armed;碰壁後進第二趟且沒歸零
  turnArmInWindow: results.turnArm.windowOpen === true && results.turnArm.armed === true,
  turnKeepsSpeed: results.afterTurn.lap === 2 && results.afterTurn.speed > 1.2,
  // ① 完賽出成績
  finishWithResult: results.finish.phase === "ended" && results.finish.overlay.visible === true
    && /觸壁|勝利/.test(results.finish.overlay.title + results.finish.overlay.eyebrow),
  // 雙人:兩人都會動
  duelBothMove: results.duelSwimming.p1.speed > 1.2 && results.duelSwimming.opp.speed > 1.2,
  // 錯過轉身=慢轉不停(溫柔)
  missTurnGentle: results.missTurn.phase === "swimming" && results.missTurn.dist > 50 && results.missTurn.speed > 0.3,
  zeroPageErrors: errors.length === 0,
};
const allGreen = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ checks, results, errors, allGreen }, null, 2));
await browser.close();
process.exit(allGreen ? 0 : 1);
