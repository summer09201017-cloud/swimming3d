import "./styles.css";
import { SwimmingGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";
import { crowdCheer } from "./idle-life.js";   // 🙌 得分那一刻:畫面與聲音同一刻

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  rankLabel: document.querySelector("#rankLabel"),
  speedTopLabel: document.querySelector("#speedTopLabel"),
  modeCode: document.querySelector("#modeCode"),
  lapLabel: document.querySelector("#lapLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  rhythmTopLabel: document.querySelector("#rhythmTopLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  gapLabel: document.querySelector("#gapLabel"),
  lapSideLabel: document.querySelector("#lapSideLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  speedMeterText: document.querySelector("#speedMeterText"),
  rhythmFill: document.querySelector("#rhythmFill"),
  rhythmValue: document.querySelector("#rhythmValue"),
  airFill: document.querySelector("#airFill"),
  airValue: document.querySelector("#airValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new SwimmingGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
/* 🙌 得分歡呼:把 audio.crowdCheer **包一層**,讓每一次喝采聲都同步叫觀眾舉手。
   ★ 為什麼不逐處補一行:上一輪就是那樣做的,而帶運算式的呼叫點
   (`event.small ? 1 : 0.6`)配不到樣式被靜靜跳過 ⇒ 本站曾經
   「終場號角會歡呼、進球當下不會」。包一層之後結構上不可能再漏。
   既有的逐處 trigger 留著無妨:trigger 取 max 不相加。 */
const _crowdCheerSfx = audio.crowdCheer.bind(audio);
audio.crowdCheer = (strength = 1) => { crowdCheer(game).trigger(strength); return _crowdCheerSfx(strength); };
window.__swimming3d = game; // dev hook:Playwright 驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

// —— 中文播報:畫面字幕條+預烤 mp3 人聲同步唸(人聲鐵律:沒烤過的句子只出字幕) ——
function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd(); // LA 2028 泳池滿場觀眾——環境音照鐵則開
      audio.vibrate(18);
      pushCommentary("歡迎來到游泳自由式 100 公尺!左右交替划水,游出全速!", "info", "歡迎來到游泳自由式一百公尺決賽!左右交替划水,游出全速!");
      window.psPing?.("-start");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!雙臂交替划水,節奏穩住!", "info", "出發!雙臂交替划水,節奏穩住就是快!");
      break;
    }
    case "rhythm-good": {
      audio.scoreSting();
      pushCommentary("節奏漂亮,越游越快!", "hot", "划水節奏漂亮,越游越快了!");
      break;
    }
    case "stumble": {
      audio.thud(0.6);
      audio.vibrate([40, 20, 40]);
      pushCommentary(`${event.who} 划亂了——穩住節奏!`, "cool", "哎呀,划亂了一下,穩住左右節奏再來!");
      break;
    }
    // ★換氣時機(本作新機制)
    case "breath-window": {
      if (event.first) pushCommentary("綠色換氣窗亮了——按 S 側頭換氣!", "cool", "綠色換氣窗亮了,按下換氣鍵側頭吸一口氣!");
      break;
    }
    case "breath-good": {
      audio.swish();
      pushCommentary("側頭換氣成功——氣量回滿!", "hot", "側頭換氣成功,一口好氣,繼續往前衝!");
      break;
    }
    case "choke": {
      audio.thud(0.7);
      audio.vibrate([50, 30, 50]);
      pushCommentary("嗆到水了——等綠窗再換氣!", "cool", "咳咳,嗆到水了,等綠色換氣窗亮起再換氣!");
      break;
    }
    case "air-low":
    case "air-empty": {
      audio.buzzer();
      pushCommentary("氣快用完了——把握換氣窗!", "cool", "氣快用完了,把握下一個換氣窗深呼吸!");
      break;
    }
    // ★轉身時機
    case "turn-window": {
      if (event.first) pushCommentary("快到池壁了——按 W 蹬牆轉身!", "cool", "快到池壁了,準備按鍵蹬牆轉身!");
      break;
    }
    case "turn-good": {
      audio.swish();
      audio.crowdCheer(0.6); crowdCheer(game).trigger(0.6);
      pushCommentary("蹬牆轉身!像魚雷一樣射出去!", "hot", "蹬牆轉身漂亮,像魚雷一樣射出去!");
      break;
    }
    case "turn-slow": {
      audio.thud(0.5);
      pushCommentary("手碰壁慢轉——下次抓準綠窗!", "cool", "轉身慢了一點,沒關係,加緊節奏追回來!");
      break;
    }
    case "last-lap": {
      audio.buzzer();
      audio.crowdCheer(0.7); crowdCheer(game).trigger(0.7);
      pushCommentary("最後一趟——衝啊!", "hot", "最後一趟了,衝回出發壁,加油!");
      break;
    }
    case "lap": {
      audio.scoreSting();
      pushCommentary(`第 ${event.lap} 趟!`, "info", "又游完一趟,節奏越來越穩了!");
      break;
    }
    case "overtake": {
      audio.swish();
      audio.crowdCheer(event.ahead ? 0.7 : 0.3);
      pushCommentary(
        event.ahead ? "超越!游到前面去了!" : "被追過了——加緊節奏!",
        event.ahead ? "hot" : "cool",
        event.ahead ? "超越了!游到前面去了!" : "被追過了,加緊節奏追回來!",
      );
      break;
    }
    case "race-end": {
      audio.horn();
      audio.crowdCheer(event.win ? 1 : 0.5);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.win ? "第一個觸壁!" + event.elapsed.toFixed(1) + " 秒!" : "AI 先到了——再來一場!",
        event.win ? "hot" : "cool",
        event.win ? "觸壁!你是第一名,全場歡呼!" : "觸壁完賽!對手先到一步,再來一場!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      window.psPing?.("-done", event.elapsed);
      break;
    }
    case "duel-end": {
      audio.horn();
      audio.crowdCheer(1); crowdCheer(game).trigger(1);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.winner === "p1" ? "P1(紅帽)獲勝!" : "P2(藍帽)獲勝!",
        "hot",
        event.winner === "p1" ? "紅帽選手獲勝,游得真漂亮!" : "藍帽選手獲勝,游得真漂亮!",
      );
      window.psPing?.("-done", event.elapsed);
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.rankLabel.textContent = state.rankText;
  ui.speedTopLabel.textContent = state.speedText;
  ui.modeCode.textContent = ({ 單人競速: "競速", 雙人同機: "雙人", 練習池: "練習" })[state.modeLabel] || state.modeLabel;
  ui.lapLabel.textContent = state.lapText;
  ui.timeLabel.textContent = state.timeText;
  ui.rhythmTopLabel.textContent =
    state.lastResult === null ? "—"
      : state.lastResult === "perfect" ? "完美!"
        : state.lastResult === "good" ? "好!"
          : state.lastResult === "fast" ? "太急"
            : "同側!";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.gapLabel.textContent = state.gapText;
  ui.lapSideLabel.textContent = state.lapText;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  setMeterFill(ui.rhythmFill, state.rhythm01);
  ui.rhythmValue.textContent = state.swimming ? `${Math.round(state.rhythm01 * 100)}%(下一划:${state.nextSide})` : "—";
  // ★氣量條+換氣窗指示(判定=畫面:綠窗亮=真的能換氣)
  setMeterFill(ui.airFill, state.air01);
  ui.airFill.classList.toggle("air-low", state.airLow);
  ui.airFill.classList.toggle("breath-open", state.breathOpen);
  ui.airValue.textContent = !state.swimming ? "—"
    : state.breathOpen ? "綠窗開!按 S 換氣!"
      : state.choking ? "嗆水中……"
        : state.airLow ? `氣量 ${Math.round(state.air01 * 100)}%(快見底!)`
          : `氣量 ${Math.round(state.air01 * 100)}%`;
  { // 中下方大狀態條:游泳中顯示;優先序=轉身窗 > 換氣窗 > 節奏
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill"), bl = document.getElementById("bigPowerLabel");
    if (bp) {
      bp.hidden = !state.swimming;
      if (state.turnOpen || state.turnArmed) {
        bl.textContent = state.turnArmed ? "蹬牆預備 ✓ 碰壁瞬間轉身!" : "轉身窗!按 W 蹬牆轉身!";
        bf.style.transform = "scaleX(1)";
        bf.classList.toggle("full", true);
      } else if (state.breathOpen) {
        bl.textContent = "換氣窗!按 S 側頭換氣!";
        bf.style.transform = "scaleX(1)";
        bf.classList.toggle("full", true);
      } else {
        bl.textContent = `划水節奏(左右交替)下一划:${state.nextSide}｜氣量 ${Math.round(state.air01 * 100)}%`;
        bf.style.transform = `scaleX(${Math.min(1, state.rhythm01)})`;
        bf.classList.toggle("full", state.rhythm01 > 0.8);
      }
    }
  }
  // 競速小地圖:泳池外框+終點+我(紅)+對手(藍)
  {
    const mm = document.getElementById("miniMap");
    const showMap = state.race && state.phaseLabel !== "主選單";
    mm.hidden = !showMap;
    if (showMap) {
      const ctx = mm.getContext("2d");
      const d = game.getMinimapData();
      ctx.clearRect(0, 0, mm.width, mm.height);
      const sx = (x) => ((x + 28) / 56) * mm.width;
      const sy = (z) => ((z + 10) / 20) * mm.height;
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      d.path.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.fillRect(sx(d.finish[0]) - 2, sy(d.finish[1]) - 6, 4, 12);
      if (d.opp) {
        ctx.fillStyle = "#4d9fff";
        ctx.beginPath();
        ctx.arc(sx(d.opp[0]), sy(d.opp[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ff5544";
      ctx.beginPath();
      ctx.arc(sx(d.me[0]), sy(d.me[1]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.font = "bold 12px system-ui";
      ctx.fillText(state.gapText, 8, 16);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW——SW 快取會讓每次改動都吃到「上一版」(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();


// ── 真實停留 -dwell(07-25 廣佈:開頁到離開單發回報,手機安全;/stats 真實平均+最近一次)──
(function () {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return;
  var _dwT0 = Date.now(), _dwSent = false;
  function _dwLeave() {
    if (_dwSent) return; _dwSent = true;
    var s = Math.round((Date.now() - _dwT0) / 1000);
    if (s >= 3 && s <= 1800 && navigator.sendBeacon)
      navigator.sendBeacon("https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=swimming3d-dwell&t=" + s);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") _dwLeave(); });
  window.addEventListener("pagehide", _dwLeave);
})();
