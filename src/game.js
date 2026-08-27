import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";
import { animateIdleHead, animateCrowdCheer, EAR_SAFE_PHI, crowdCheer } from "./idle-life.js"; // idle 生動共用資產(3d-figure-kit)
import { createWaterSurface, createLaneRope, applyBuoyancy, SplashSystem } from "./water.js"; // water-kit:水面/浮力/水花(整檔收割,一字不改)

// —— 游泳(自由式)3D(swimming3d)——fork 自 speedskating3d(B1,LA 2028 夏奧皮)。
// 賽道:50m 直道泳池(直線來回 2 趟=100m)——原橢圓 ovalPoint 換成直線 pathPoint(距離→座標+方向,轉身處方向翻轉)。
// 玩法核心(節奏交替划水,speed-race-kit tapPush 範式,判定邏輯不動、只換名詞):
//   ①左右交替按鍵踩節奏(P1=A/D=左右臂)——交替且節奏穩=加速;連按同側/亂節奏=划亂減速(溫柔,不失敗)。
//   ②★換氣時機(本作新機制):氣量緩慢下降;每隔幾秒 HUD 出現綠色換氣窗,窗內按 S=側頭換氣(氣量回滿、不掉速);
//     窗外按=嗆水(短暫減速,溫柔);氣量見底=強制慢速直到成功換氣。幼幼檔:氣掉更慢+窗更寬+assist 自動換氣。
//   ③★轉身時機:接近池壁出現綠窗(skijump timeToEdge 倒數逼近型),窗內按 W=蹬牆轉身(保速+小加速);錯過=手碰壁慢轉(溫柔)。
// 模式:單人對 AI(各一水道)/ 雙人同機(P2 第三水道)/ 練習池。
// ★判定=畫面:換氣窗/轉身窗看得到才算;★溫柔規則:永不失敗死當,只減速。

// ---------- 可調量值 ----------
// push=划水增益比、ideal=理想划頻(秒)、tol=節奏容錯窗、maxSpeed=速度上限(m/s)、trips=趟數、
// assist=幼兒節奏輔助、aiSkill=AI 品質、airDrain=氣量每秒消耗、breathEvery=換氣窗間隔(秒)、
// breathWindow=換氣窗寬(秒)、turnWindow=轉身綠窗(離牆秒數)、assistBreath=自動換氣(幼幼)
export const DIFFICULTY_PRESETS = {
  kids: { push: 0.2, ideal: 0.5, tol: 0.66, maxSpeed: 3.0, trips: 2, assist: 0.55, aiSkill: 0.3, airDrain: 0.04, breathEvery: 3.6, breathWindow: 2.2, turnWindow: 1.8, assistBreath: true },
  child: { push: 0.19, ideal: 0.46, tol: 0.58, maxSpeed: 3.4, trips: 2, assist: 0.32, aiSkill: 0.46, airDrain: 0.06, breathEvery: 4.0, breathWindow: 1.6, turnWindow: 1.4, assistBreath: false },
  easy: { push: 0.18, ideal: 0.42, tol: 0.5, maxSpeed: 3.8, trips: 2, assist: 0.15, aiSkill: 0.58, airDrain: 0.075, breathEvery: 4.4, breathWindow: 1.2, turnWindow: 1.1, assistBreath: false },
  normal: { push: 0.17, ideal: 0.38, tol: 0.42, maxSpeed: 4.2, trips: 2, assist: 0, aiSkill: 0.7, airDrain: 0.09, breathEvery: 4.8, breathWindow: 0.95, turnWindow: 0.85, assistBreath: false },
  hard: { push: 0.165, ideal: 0.34, tol: 0.34, maxSpeed: 4.6, trips: 2, assist: 0, aiSkill: 0.84, airDrain: 0.105, breathEvery: 5.0, breathWindow: 0.75, turnWindow: 0.65, assistBreath: false },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  race: {
    label: "單人競速",
    race: true,
    description: "跟 AI 選手隔壁水道對決——左右交替划水、綠窗按 S 換氣、近池壁按 W 蹬牆轉身,先觸壁的贏!",
    goal: "先觸壁者勝(50m 來回=100m)",
  },
  duel2p: {
    label: "雙人同機",
    race: true,
    duel: true,
    description: "一台鍵盤兩位泳者:P1(紅帽)=A/D 划水+S 換氣+W 轉身;P2(藍帽)=←/→ 划水+↓ 換氣+↑ 轉身!",
    goal: "先觸壁者勝",
  },
  practice: {
    label: "練習池",
    endless: true,
    description: "沒有對手、無限趟數——自由練划水節奏、換氣時機與蹬牆轉身的手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.race;
}

// 泳者隊色(P1 紅帽、P2 藍帽=系列題目拍板;AI 綠帽)
export const SUITS = {
  p1: { label: "紅帽選手", suit: 0xc63c34, trim: 0xf2e9d8 },
  p2: { label: "藍帽選手", suit: 0x2f6fd8, trim: 0xf2e9d8 },
  ai: { label: "綠帽選手", suit: 0x3f9b5a, trim: 0xf6d743 },
};

// ---------- 泳池常數(50m 直道,直線來回) ----------
const POOL_LEN = 50; // 泳池長(m):x 從 -25 到 +25
const POOL_HALF_W = 6.25; // 泳池半寬(5 條 2.5m 水道)
const LANE_W = 2.5; // 水道寬
const LANE_P1 = 0; // P1 中央水道(z)
const LANE_OPP = LANE_W; // AI 隔壁水道
const LANE_P2 = -LANE_W; // 雙人時 P2 第三水道
const TAP_TOO_FAST = 0.14; // 比這更快的連打=划水打結
const STUMBLE_DUR = 0.9; // 划亂恢復秒數
const BASE_DRAG = 0.34; // 水阻(比冰面大=放開會慢下來,但仍有滑行感)
const AIR_LOW = 0.25; // 氣量警戒線(HUD 變紅)
const FORCED_SLOW_MUL = 0.45; // 氣量見底的強制慢速倍率(溫柔:仍游得動)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 直線 path 幾何:d=累計里程(m),laneZ=水道 z 座標(絕對值,不隨方向翻)。
// 每 50m 一趟:偶數趟 x 由 -25→+25、奇數趟折返;轉身處方向 tx 翻轉。
function pathPoint(d, laneZ = 0) {
  const leg = Math.max(0, Math.floor(d / POOL_LEN));
  const s = d - leg * POOL_LEN;
  const forward = leg % 2 === 0;
  const x = forward ? -POOL_LEN / 2 + s : POOL_LEN / 2 - s;
  return { x, z: laneZ, tx: forward ? 1 : -1, tz: 0, leg };
}

// 下一面池壁的里程(=下一個 50m 倍數)
function nextWallDist(d) {
  return (Math.floor(d / POOL_LEN) + 1) * POOL_LEN;
}

// ---------- 人物(照 3d-figure-kit 鐵則:矩形身體/長腿/臉部眼耳嘴眉齊) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

// makePerson 游泳版:泳帽(隊色)+蛙鏡+連身泳衣(軀幹隊色、手臂/小腿露膚、赤腳);
// 上半身收進 torso 樞紐;臉照鐵則(眼白+瞳孔/耳/眉/嘴、耳前無髮)。
function makePerson({ suit = 0x2f6f4e, trim = 0xf2e9d8, skin = 0xf3cca6, hair = 0x2b2119, hood = true, goggles = false, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.55 });
  const pantsMat = suitMat; // 連身泳衣:上下一體
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  // 腰樞紐:胸/頭/手臂全掛這裡
  const torso = new THREE.Group();
  torso.position.y = 1.16;
  rig.add(torso);
  const T = (y) => y - 1.16; // 原立姿座標 → torso 局部

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), suitMat);
  chest.position.y = T(1.42);
  torso.add(chest);
  const upperChest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.3), suitMat);
  upperChest.position.y = T(1.7);
  torso.add(upperChest);
  for (const sx of [-1, 1]) {
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), skinMat);
    deltoid.position.set(sx * 0.37, T(1.73), 0);
    torso.add(deltoid);
  }
  // 胸前飾條(隊色滾邊,讓紅/藍帽一眼可辨)
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 });
  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.02), trimMat);
  chestStripe.position.set(0, T(1.44), 0.17);
  torso.add(chestStripe);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = T(1.88);
  torso.add(neck);

  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), suitMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  rig.add(waist);

  // 頭+臉群組(idle 生動:整顆頭連臉一起轉;樞紐=頭中心 T(2.12))
  const headGroup = new THREE.Group();
  headGroup.position.set(0, T(2.12), 0);
  torso.add(headGroup);
  const H = (y) => y - 2.12;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = H(2.12);
  headGroup.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, H(2.11), 0);
  headGroup.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  headGroup.add(earR);

  // 泳帽(隊色)或髮——★耳前無髮鐵律:帽/髮只坐額頭上緣→頭頂/後腦,兩鬢與耳前留空。
  const capMat = hood ? suitMat : new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), capMat);
  hairCap.position.y = H(2.14);
  headGroup.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.258, 16, 12, EAR_SAFE_PHI.start, EAR_SAFE_PHI.end - EAR_SAFE_PHI.start, Math.PI * 0.12, Math.PI * 0.62),
    capMat,
  );
  hairBack.position.y = H(2.13);
  headGroup.add(hairBack);
  if (!hood) {
    void hair;
  }

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, H(2.18), 0.21);
  headGroup.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  headGroup.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, H(2.18), 0.25);
  headGroup.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  headGroup.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, H(2.26), 0.22);
  browL.rotation.z = 0.16;
  headGroup.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  headGroup.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, H(2.04), 0.21);
  smile.rotation.z = Math.PI;
  headGroup.add(smile);

  // 蛙鏡(泳者限定):深色鏡片罩在眼睛外+環頭鏡帶——帶緣貼眼高、不遮嘴、不蓋耳前
  if (goggles) {
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x14324a, roughness: 0.2, metalness: 0.35 });
    const lensL = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 10), lensMat);
    lensL.scale.set(1, 0.85, 0.55);
    lensL.position.set(-0.09, H(2.18), 0.225);
    headGroup.add(lensL);
    const lensR = lensL.clone();
    lensR.position.x = 0.09;
    headGroup.add(lensR);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.252, 0.016, 8, 24), lensMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.y = H(2.18);
    headGroup.add(strap);
  }

  // 手臂=露膚(自由式划水看得到手臂),手=膚色五指
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: skinMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, T(1.72), 0);
    arm.joint.rotation.x = -0.18;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), skinMat);
    elbow.position.set(0, -0.27, 0);
    arm.pivot.add(elbow);
    torso.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  // 腿:大腿=泳衣(及膝 jammer)、小腿露膚、赤腳
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072, // 長腿 v2:腿明顯長於身
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), skinMat);
    knee.position.set(0, -0.4, 0);
    leg.pivot.add(knee);
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, torso, head, headGroup, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

// 水平俯臥泳姿基準(figure.group 在 buoy 群組裡:rotation.x=+π/2 → 身體俯臥、頭朝行進方向、臉朝水面)
const PRONE_ROT = Math.PI / 2 - 0.1; // 微抬=背露出水面一點
const PRONE_Y = 0.5; // 俯臥後把身體中線抬回水線附近(applyBuoyancy sink=0.55 是立姿定義,俯臥要補償)
const PRONE_Z = -1.15; // 身體中心對齊 racer 座標(原點在腳底,往後挪半個身長)

function poseSwimmerFloatIdle(f) {
  // 出發前漂浮:雙臂前伸(流線)、腿伸直、身體俯臥
  f.torso.rotation.x = 0;
  f.rig.position.y = 0;
  f.rig.rotation.y = 0;
  f.headGroup.rotation.set(-0.55, 0, 0); // 抬頭看前方(俯臥時 -x=抬臉)
  for (const leg of [f.leftLeg, f.rightLeg]) {
    leg.pivot.rotation.x = 0.05;
    leg.pivot.rotation.z = 0;
    leg.joint.rotation.x = 0.06;
  }
  for (const arm of [f.leftArm, f.rightArm]) {
    arm.pivot.rotation.x = Math.PI * 0.96; // 指向頭前=前伸流線
    arm.pivot.rotation.z = 0;
    arm.joint.rotation.x = -0.08;
  }
}

export class SwimmingGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "race";
    this.mode = getModeConfig(this.modeId);

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則——絕不再宣告同名狀態)
    this.time = 0;
    this.phase = "menu"; // menu | gate | swimming | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播(右) 2 高空 3 貼水面 4 側面轉播(左) —— 共 5 視角
    this.autoSaveTimer = 0;
    this.elapsed = 0;
    this.laps = 2; // trips(★建構子所有進鏡頭運算的狀態給數字初值——選單期 NaN 鏡頭中毒鐵則)
    this.finishDist = POOL_LEN * 2;
    this.lastGapSign = 0;
    this._turnWasOpen = false;
    this._breathWasOpen = false;
    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fd4f0);
    this.scene.fog = new THREE.Fog(0x9fd4f0, 150, 560);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1200);
    this.camPos = new THREE.Vector3(0, 8, -20);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.setupScene();
    this.resetRacers();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 場景:50m 直道泳池(LA 2028 夏日氛圍) ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x7fa6b8, 1.2);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff4dd, 1.8);
    key.position.set(35, 55, -25);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    // 場館地坪(池外大地面)
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshStandardMaterial({ color: 0xc9d6dd, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.55;
    this.scene.add(apron);

    // 水面(water-kit createWaterSurface:CPU 頂點波,每幀刷)
    this.water = createWaterSurface({ width: POOL_LEN, length: POOL_HALF_W * 2, segX: 96, segZ: 26 });
    this.scene.add(this.water.mesh);
    // 池底(淡藍磁磚+黑色水道底線)
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(POOL_LEN, POOL_HALF_W * 2),
      new THREE.MeshStandardMaterial({ color: 0xbfe4f2, roughness: 0.7 }),
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -1.8;
    this.scene.add(bottom);
    for (let li = -2; li <= 2; li += 1) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(POOL_LEN - 4, 0.28),
        new THREE.MeshBasicMaterial({ color: 0x123a52 }),
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, -1.79, li * LANE_W);
      this.scene.add(line);
    }

    // 水道繩(water-kit createLaneRope:紅黃浮球串,每幀隨浪起伏)
    this.laneRopes = [];
    for (let li = -2; li <= 3; li += 1) {
      const z = (li - 0.5) * LANE_W; // -6.25,-3.75,-1.25,1.25,3.75,6.25
      this.laneRopes.push(createLaneRope(this.scene, {
        from: { x: -POOL_LEN / 2, z }, to: { x: POOL_LEN / 2, z }, spacing: 0.6,
      }));
    }

    // 水花系統(划水/轉身/嗆水共用)
    this.splash = new SplashSystem(this.scene, { maxParticles: 240, maxRings: 20 });

    // 池壁+池畔平台(deck):四面圍住水面,頂面高於水線
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.9 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2f7fc2, roughness: 0.7 });
    const mkDeck = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.85, d), deckMat);
      m.position.set(x, -0.12, z);
      this.scene.add(m);
    };
    mkDeck(POOL_LEN + 24, 11, 0, POOL_HALF_W + 5.6); // 兩長邊
    mkDeck(POOL_LEN + 24, 11, 0, -(POOL_HALF_W + 5.6));
    mkDeck(11.6, POOL_HALF_W * 2 + 0.4, -(POOL_LEN / 2 + 5.9), 0); // 兩短邊(出發端/轉身端)
    mkDeck(11.6, POOL_HALF_W * 2 + 0.4, POOL_LEN / 2 + 5.9, 0);
    // 池緣藍邊條
    for (const s of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(POOL_LEN + 0.8, 0.16, 0.4), edgeMat);
      lip.position.set(0, 0.32, s * (POOL_HALF_W + 0.2));
      this.scene.add(lip);
      const lipEnd = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, POOL_HALF_W * 2 + 0.8), edgeMat);
      lipEnd.position.set(s * (POOL_LEN / 2 + 0.2), 0.32, 0);
      this.scene.add(lipEnd);
    }
    // 兩端觸壁板(轉身/終點計時板:黃色,判定=畫面——蹬牆轉身就是蹬這面板)
    const padMat = new THREE.MeshStandardMaterial({ color: 0xf6d743, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, POOL_HALF_W * 2 - 0.3), padMat);
      pad.position.set(s * (POOL_LEN / 2 + 0.02), -0.35, 0);
      this.scene.add(pad);
    }

    // 出發台(5 水道,出發端 x=-25 側)
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.75 });
    const blockTopMat = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.7 });
    for (let li = -2; li <= 2; li += 1) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), blockMat);
      base.position.set(-(POOL_LEN / 2 + 0.9), 0.55, li * LANE_W);
      this.scene.add(base);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.95), blockTopMat);
      top.position.set(-(POOL_LEN / 2 + 0.9), 0.9, li * LANE_W);
      top.rotation.z = -0.12;
      this.scene.add(top);
      // 水道號碼牌
      const num = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.34), blockTopMat);
      num.position.set(-(POOL_LEN / 2 + 1.4), 0.45, li * LANE_W);
      this.scene.add(num);
    }

    // 5m 轉身提示旗(兩端 x=±20:彩旗橫過泳池——接近旗=轉身窗快到,判定=畫面的前置視覺)
    const flagPole = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6 });
    const flagCols = [0xd8433c, 0xf6d743, 0x2f6fd8, 0x3f9b5a];
    for (const s of [-1, 1]) {
      const fx = s * (POOL_LEN / 2 - 5);
      for (const zs of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), flagPole);
        post.position.set(fx, 1.3, zs * (POOL_HALF_W + 0.9));
        this.scene.add(post);
      }
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, POOL_HALF_W * 2 + 1.8), flagPole);
      rope.position.set(fx, 2.55, 0);
      this.scene.add(rope);
      for (let i = 0; i < 12; i += 1) {
        const flag = new THREE.Mesh(
          new THREE.ConeGeometry(0.13, 0.42, 4),
          new THREE.MeshStandardMaterial({ color: flagCols[i % flagCols.length], roughness: 0.8 }),
        );
        flag.rotation.x = Math.PI; // 尖端朝下=懸掛在旗繩下的三角旗
        flag.position.set(fx, 2.3, -POOL_HALF_W - 0.6 + i * ((POOL_HALF_W * 2 + 1.2) / 11));
        this.scene.add(flag);
      }
    }

    // 終點拱門(出發端上方:100m 終點=回到出發壁)
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10),
        new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6 }),
      );
      post.position.set(-(POOL_LEN / 2 + 2.4), 2.1, s * (POOL_HALF_W + 0.9));
      this.scene.add(post);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, POOL_HALF_W * 2 + 1.8), bannerMat);
    banner.position.set(-(POOL_LEN / 2 + 2.4), 4.0, 0);
    this.scene.add(banner);

    // 兩側觀眾看台+有臉觀眾(夏日輕便色)
    const standMat = new THREE.MeshStandardMaterial({ color: 0x5f6d80, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(58, 3.4, 5), standMat);
      stand.position.set(0, 1.7, side * (POOL_HALF_W + 13.5));
      this.scene.add(stand);
    }
    this.buildCrowd();

    // 棕櫚樹(LA 2028 夏奧場外)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9b5a, roughness: 0.9 });
    for (const [x, z] of [[-42, 14], [-40, -16], [42, 16], [44, -12], [-32, 24], [30, 26], [0, -26], [36, -24], [-36, -24], [50, 4], [-52, -2]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.6, 6), trunkMat);
      trunk.position.set(x, 1.8, z);
      trunk.rotation.z = (x > 0 ? -1 : 1) * 0.06;
      this.scene.add(trunk);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.2, 4), leafMat);
        leaf.position.set(x + Math.cos(a) * 0.9, 4.15, z + Math.sin(a) * 0.9);
        leaf.rotation.order = "YXZ";
        leaf.rotation.y = -a + Math.PI / 2;
        leaf.rotation.x = Math.PI / 2 + 0.55;
        this.scene.add(leaf);
      }
    }

    // 泳者(P1 紅帽=中央水道;AI 綠帽/P2 藍帽=隔壁水道)——
    // 節點階層:node(位置+朝向) > buoy(浮力 y+隨浪傾斜) > figure.group(俯臥姿)
    const mkSwimmerNode = (figure) => {
      const node = new THREE.Group();
      const buoy = new THREE.Group();
      node.add(buoy);
      figure.group.rotation.x = PRONE_ROT;
      figure.group.position.set(0, PRONE_Y, PRONE_Z);
      buoy.add(figure.group);
      this.scene.add(node);
      return { node, buoy };
    };
    this.p1Figure = makePerson({ suit: SUITS.p1.suit, trim: SUITS.p1.trim, goggles: true });
    this.p1Node = mkSwimmerNode(this.p1Figure);
    this.p2Figure = makePerson({ suit: SUITS.p2.suit, trim: SUITS.p2.trim, goggles: true });
    this.p2Node = mkSwimmerNode(this.p2Figure);
    this.aiFigure = makePerson({ suit: SUITS.ai.suit, trim: SUITS.ai.trim, skin: 0xe8b98a, goggles: true });
    this.aiNode = mkSwimmerNode(this.aiFigure);
    poseSwimmerFloatIdle(this.p1Figure);
    poseSwimmerFloatIdle(this.p2Figure);
    poseSwimmerFloatIdle(this.aiFigure);
  }

  buildCrowd() {
    this.crowd = new THREE.Group();
    this.crowdFigures = []; // 決定性相位,供 animateCrowd 每幀驅動(舉手歡呼+左右看)
    const coats = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makePerson({
          suit: coats[(i + (side > 0 ? 3 : 0)) % coats.length],
          trim: 0xf2e9d8,
          hood: false,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.torso.rotation.x = 0.05; // 觀眾站直
        p.rig.position.y = 0;
        for (const leg of [p.leftLeg, p.rightLeg]) {
          leg.pivot.rotation.x = -0.05;
          leg.joint.rotation.x = 0.1;
        }
        p.group.position.set(-27 + i * 9, 3.4, side * (POOL_HALF_W + 12.2));
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
        // 相位=座號×0.9+對側偏移(決定性!絕不用建構期 Math.random)→ 此起彼落的人浪
        this.crowdFigures.push({ fig: p, phase: i * 0.9 + (side > 0 ? 1.7 : 0), rigY: p.rig.position.y });
      }
    }
    this.scene.add(this.crowd);
  }

  animateCrowd() {
    animateCrowdCheer(this.crowdFigures, this.time, { cheer: crowdCheer(this).stepAt(this.time) });
  }

  // idle 生動:主選單/出發前——整顆頭偶爾平滑轉一下+微笑(邏輯在共用資產 idle-life.js)
  animateHead(r) {
    const f = r && r.figure;
    if (!f) return;
    if (this.phase !== "menu" && this.phase !== "gate") return; // 游泳中頭部歸 poseSwimmer(換氣側頭)管
    animateIdleHead(f.headGroup, f.smile, this.time, {
      phase: r.glancePhase || 0,
      period: r.glancePeriod || 5.4,
    });
    f.headGroup.rotation.x = -0.55; // 俯臥漂浮仍抬臉看前方(疊在 idle 轉頭上)
  }

  // ---------- racer 結構(duel-2p-kit §7C:P1/P2/AI 同一套,只差輸入來源) ----------
  mkRacer(figure, nodePair, lane, label) {
    const isP1 = label === "P1";
    return {
      figure,
      node: nodePair.node,
      buoy: nodePair.buoy,
      lane, // 水道 z 座標(絕對)
      label,
      glancePhase: isP1 ? 0 : 2.9,
      glancePeriod: isP1 ? 5.4 : 6.3,
      bobPhase: isP1 ? 0 : 2.1,
      dist: 0,
      speed: 0,
      strideT: 0,
      lastSide: null,
      lastTapAt: -9,
      rhythm01: 0,
      stumbleT: 0,
      kickT: 9,
      kickSide: null,
      lap: 1, // 第幾趟(1..trips)
      finished: false,
      finishTime: 0,
      aiTapTimer: 0,
      lastResult: null, // 'perfect' | 'good' | 'fast' | 'same' | null
      // ★換氣(全部數字/布林初值——選單期 NaN 鏡頭中毒鐵則)
      air: 1,
      breathCycleT: 0,
      breathAnimT: 0,
      breathSide: 1,
      chokeT: 0,
      airEmptyT: 0,
      lowAirWarned: false,
      aiBreathDelay: -1,
      // ★轉身
      turnArmed: false,
      turnFlashT: 0,
      turnSlowT: 0,
      aiTurnRoll: -1,
      aiTurnDelay: -1,
    };
  }

  _isHuman(who) {
    return who === "p1" || this.modeId === "duel2p";
  }

  resetRacers() {
    this.p1 = this.mkRacer(this.p1Figure, this.p1Node, LANE_P1, "P1");
    const duel = this.modeId === "duel2p";
    this.opp = duel
      ? this.mkRacer(this.p2Figure, this.p2Node, LANE_P2, "P2")
      : this.mkRacer(this.aiFigure, this.aiNode, LANE_OPP, "AI");
    this.p2Node.node.visible = duel;
    this.aiNode.node.visible = !duel && !!this.mode.race;
    this.p1.dist = 0;
    this.opp.dist = 0;
    this.lastGapSign = 0;
    this.rhythmCheered = false;
    this.lastLapAnnounced = false;
    this._turnHintShown = false;
    this._breathHintShown = false;
    this._turnWasOpen = false;
    this._breathWasOpen = false;
    this.placeRacer(this.p1);
    this.placeRacer(this.opp);
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      // 觸控/點畫面:出發;游泳中=自動左右交替划(平板孩子單指也能玩)
      if (this.phase === "gate") {
        this.beginRace();
      } else if (this.phase === "swimming") {
        const next = this.p1.lastSide === "L" ? "R" : "L";
        this.tapPush(this.p1, next);
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.elapsed = 0;
    this.resetRacers();
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.laps = this.mode.endless ? Infinity : preset.trips;
    this.finishDist = this.mode.endless ? Infinity : preset.trips * POOL_LEN;
    this.cameraView = 0; // 每場回到跟隨視角
    // 起賽鏡頭直接切到泳者後方(joash 教訓:lerp 穿場=整幀糊掉)
    const p0 = pathPoint(0, LANE_P1);
    this.camPos.set(p0.x - p0.tx * 9, 4.2, p0.z - 2.5);
    this.camLook.set(p0.x, 0.4, p0.z);
    this.phase = "gate";
    this.message = this.modeId === "duel2p"
      ? "按空白鍵(或點畫面)出發!P1=A/D 划水+S 換氣+W 轉身;P2=←/→+↓+↑!"
      : "按空白鍵(或點畫面)出發!A/D 左右臂交替划水,綠窗按 S 換氣、近壁按 W 轉身!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  beginRace() {
    if (this.phase !== "gate") return;
    this.phase = "swimming";
    this.p1.speed = 1.2;
    this.opp.speed = 1.2;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.opp.aiTapTimer = preset.ideal * 0.6;
    this.message = "出發!左右臂交替划水——節奏穩才快!";
    this.emitEvent("gate", {});
    this.pushHud();
  }

  // ---------- 節奏划水(speed-race-kit tapPush:判定邏輯不動,名詞蹬冰→划水) ----------
  tapPush(racer, side) {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.beginRace();
      // 出發那一下也算第一划
    }
    if (this.phase !== "swimming" || racer.finished) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const now = this.time;
    const gap = now - racer.lastTapAt;
    racer.lastTapAt = now;

    // 連按同側=划亂了(溫柔:掉速+短暫無力,不失敗)
    if (racer.lastSide === side) {
      racer.lastSide = side;
      racer.speed *= 0.8;
      racer.stumbleT = STUMBLE_DUR;
      racer.rhythm01 *= 0.35;
      racer.lastResult = "same";
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = `${this.racerName(racer)} 連划同一隻手——划亂了!左右交替才順!`;
        this.emitEvent("stumble", { who: racer.label });
      }
      this.pushHud();
      return;
    }
    racer.lastSide = side;

    // 亂節奏:連打太快=手忙腳亂,小亂划
    if (gap < TAP_TOO_FAST) {
      racer.speed *= 0.9;
      racer.stumbleT = STUMBLE_DUR * 0.55;
      racer.rhythm01 *= 0.5;
      racer.lastResult = "fast";
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = "太急了——划一下、滑一下,跟著節奏!";
        this.emitEvent("stumble", { who: racer.label, soft: true });
      }
      this.pushHud();
      return;
    }

    let q = clamp(1 - Math.abs(gap - preset.ideal) / preset.tol, 0, 1);
    q = clamp(q + preset.assist * (1 - q), 0, 1); // 幼兒輔助:往好節奏拉
    this.applyPush(racer, q, side);
    racer.rhythm01 = racer.rhythm01 * 0.55 + q * 0.45;
    racer.lastResult = q >= 0.85 ? "perfect" : "good";
    if (racer === this.p1 && racer.rhythm01 > 0.8 && !this.rhythmCheered) {
      this.rhythmCheered = true;
      this.emitEvent("rhythm-good", {});
    }
  }

  applyPush(racer, q, side) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const weak = racer.stumbleT > 0 ? 0.45 : 1;
    const gain = (preset.maxSpeed * 1.18 - racer.speed) * preset.push * (0.35 + 0.65 * q) * weak;
    racer.speed = Math.min(preset.maxSpeed * 1.05, racer.speed + Math.max(0, gain));
    // 動畫:划水 kick+把划頻相位對齊入水的那隻手
    racer.kickT = 0;
    racer.kickSide = side;
    racer.strideT = side === "L" ? 0.55 : 0.05;
    // 划水小水花(判定=畫面:入水點在頭前方、划水那一側)
    const p = pathPoint(racer.dist, racer.lane);
    this.splash.spawn(p.x + p.tx * 1.4, p.z + (side === "L" ? -0.35 : 0.35), 0.22 + q * 0.2, this.time);
  }

  // ---------- ★換氣時機(本作新機制:綠窗看得到=判定=畫面同一函式) ----------
  // 窗口狀態:氣量見底時窗常開(溫柔:一定換得到氣);否則照 breathEvery/breathWindow 週期
  breathWindowOpen(r) {
    if (this.phase !== "swimming" || r.finished) return false;
    if (r.air <= 0.02) return true;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    return r.breathCycleT >= preset.breathEvery && r.breathCycleT <= preset.breathEvery + preset.breathWindow;
  }

  pressBreath(racer) {
    if (this.overlay.visible) return;
    if (this.phase !== "swimming" || racer.finished) return;
    if (this.breathWindowOpen(racer)) {
      // 窗內=側頭換氣:氣量回滿、不掉速
      racer.air = 1;
      racer.breathCycleT = 0;
      racer.breathAnimT = 0.8;
      racer.breathSide = racer.lastSide === "L" ? -1 : 1;
      racer.airEmptyT = 0;
      racer.lowAirWarned = false;
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = `${this.racerName(racer)} 側頭換氣成功——一口好氣,繼續衝!`;
        this.emitEvent("breath-good", { who: racer.label });
      }
    } else {
      // 窗外=嗆水:短暫減速(溫柔,不失敗)
      racer.chokeT = 0.9;
      racer.speed *= 0.72;
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = "咳咳——嗆到水了!等綠色換氣窗亮起再按!";
        this.emitEvent("choke", { who: racer.label });
      }
      const p = pathPoint(racer.dist, racer.lane);
      this.splash.spawn(p.x + p.tx * 1.2, p.z, 0.5, this.time);
    }
    this.pushHud();
  }

  // ---------- ★轉身時機(skijump timeToEdge 倒數逼近型) ----------
  turnWindowOpen(r) {
    if (this.phase !== "swimming" || r.finished || r.speed < 0.3) return false;
    const wall = nextWallDist(r.dist);
    if (!this.mode.endless && wall >= this.finishDist) return false; // 最後觸壁=終點,不是轉身
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const timeToWall = (wall - r.dist) / Math.max(r.speed, 0.5);
    return timeToWall <= preset.turnWindow;
  }

  pressTurn(racer) {
    if (this.overlay.visible) return;
    if (this.phase !== "swimming" || racer.finished) return;
    if (this.turnWindowOpen(racer)) {
      if (!racer.turnArmed) {
        racer.turnArmed = true;
        if (racer === this.p1 || this.modeId === "duel2p") {
          this.message = `${this.racerName(racer)} 蹬牆預備——碰壁瞬間翻轉射出去!`;
          this.emitEvent("turn-armed", { who: racer.label });
        }
      }
    } else if (racer === this.p1 || this.modeId === "duel2p") {
      // 窗外按=只提示不懲罰(timing-meter-kit 保底鐵則)
      this.message = "還沒到池壁——看到綠色轉身窗再按!";
    }
    this.pushHud();
  }

  // 碰壁瞬間結算轉身品質(方向翻轉由 pathPoint 幾何自動處理)
  resolveTurn(racer) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const p = pathPoint(racer.dist, racer.lane);
    if (racer.turnArmed) {
      // 蹬牆轉身:保速+小加速
      racer.speed = Math.min(preset.maxSpeed * 1.08, racer.speed + 1.1);
      racer.turnFlashT = 0.7;
      this.splash.spawn(p.x - p.tx * 0.6, p.z, 0.9, this.time);
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = `${this.racerName(racer)} 蹬牆轉身!像魚雷一樣射出去!`;
        this.emitEvent("turn-good", { who: racer.label });
      }
    } else {
      // 錯過=手碰壁慢轉(溫柔:只掉速,不停不失敗)
      racer.speed *= 0.45;
      racer.turnSlowT = 0.8;
      this.splash.spawn(p.x - p.tx * 0.6, p.z, 0.35, this.time);
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = `${this.racerName(racer)} 手碰壁慢慢轉——下次在綠窗按 W 蹬牆!`;
        this.emitEvent("turn-slow", { who: racer.label });
      }
    }
    racer.turnArmed = false;
  }

  racerName(racer) {
    if (this.modeId === "duel2p") return racer === this.p1 ? "P1(紅帽)" : "P2(藍帽)";
    return racer === this.p1 ? "你" : "AI";
  }

  // ---------- 完賽 ----------
  finishRace(firstRacer) {
    this.phase = "ended";
    const duel = this.modeId === "duel2p";
    const win = firstRacer === this.p1;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    if (win) this.spawnConfetti();
    if (duel) {
      this.overlay = {
        visible: true,
        eyebrow: "觸壁!",
        title: win ? "P1(紅帽)獲勝!" : "P2(藍帽)獲勝!",
        text: `${timeText} 先觸壁!兩位泳者都游得漂亮——再來一場!`,
        canResume: false,
      };
      if (!win) this.spawnConfetti(); // 雙人:誰贏都慶祝
      this.emitEvent("duel-end", { winner: win ? "p1" : "p2", elapsed: this.elapsed });
      this.message = win ? "P1(紅帽)先觸壁!" : "P2(藍帽)先觸壁!";
    } else {
      this.overlay = {
        visible: true,
        eyebrow: win ? "勝利!" : "惜敗",
        title: win ? "第一個觸壁!" : "AI 先到了……",
        text: win
          ? `${timeText} 觸壁完賽,把${SUITS.ai.label}甩在後面!節奏+換氣+轉身,你全做到了!`
          : `差一點!穩住划水節奏、綠窗換氣、池壁蹬牆,再來一場追回來!(用時 ${timeText})`,
        canResume: false,
      };
      this.emitEvent("race-end", { win, elapsed: this.elapsed });
      this.message = win ? `勝利!${timeText} 先觸壁!` : "AI 先觸壁——再來一場!";
    }
    this.saveGame(true);
    this.pushHud();
  }

  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = pathPoint(this.p1.dist, this.p1.lane);
    for (let i = 0; i < 150; i += 1) {
      const kind = i % 3;
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 12, 7 + Math.random() * 6, p.z + (Math.random() * 2 - 1) * 12);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "抓著水道繩休息一下,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 5;
    const names = ["跟隨視角", "側面轉播(右)", "高空俯瞰", "貼水面視角", "側面轉播(左)"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;
    const duel = this.modeId === "duel2p";
    const solo = !duel;
    const preset = DIFFICULTY_PRESETS[this.difficulty];

    this.handleKeys();

    if (!paused && this.phase === "swimming") {
      this.elapsed += delta;

      // —— 玩家輸入:左右交替划水+換氣+轉身(solo 別名:單人時 P2 鍵仍有效,duel-2p-kit §3) ——
      if (this.input.consumePress("p1left")) this.tapPush(this.p1, "L");
      if (this.input.consumePress("p1right")) this.tapPush(this.p1, "R");
      if (this.input.consumePress("p2left")) this.tapPush(solo ? this.p1 : this.opp, "L");
      if (this.input.consumePress("p2right")) this.tapPush(solo ? this.p1 : this.opp, "R");
      if (this.input.consumePress("p1breath")) this.pressBreath(this.p1);
      if (this.input.consumePress("p2breath")) this.pressBreath(solo ? this.p1 : this.opp);
      if (this.input.consumePress("p1turn")) this.pressTurn(this.p1);
      if (this.input.consumePress("p2turn")) this.pressTurn(solo ? this.p1 : this.opp);

      // —— AI(單人競速):同一套 racer,輸入來源=節拍器;換氣/轉身全自動,aiSkill 控品質 ——
      if (!this._isHuman("opp") && this.mode.race && !this.opp.finished) {
        this.opp.aiTapTimer -= delta;
        if (this.opp.aiTapTimer <= 0) {
          this.opp.aiTapTimer = preset.ideal * (0.92 + Math.random() * 0.18);
          const q = clamp(preset.aiSkill + (Math.random() * 2 - 1) * 0.16, 0, 1);
          const side = this.opp.lastSide === "L" ? "R" : "L";
          this.opp.lastSide = side;
          this.applyPush(this.opp, q, side);
          this.opp.rhythm01 = this.opp.rhythm01 * 0.55 + q * 0.45;
        }
        // AI 換氣:窗開後延遲一小段(低 skill 延遲久=偶爾拖到氣快見底)
        if (this.breathWindowOpen(this.opp)) {
          if (this.opp.aiBreathDelay < 0) this.opp.aiBreathDelay = (1 - preset.aiSkill) * preset.breathWindow * 0.8;
          this.opp.aiBreathDelay -= delta;
          if (this.opp.aiBreathDelay <= 0) {
            this.opp.air = 1;
            this.opp.breathCycleT = 0;
            this.opp.breathAnimT = 0.8;
            this.opp.breathSide = this.opp.lastSide === "L" ? -1 : 1;
            this.opp.airEmptyT = 0;
            this.opp.aiBreathDelay = -1;
          }
        } else {
          this.opp.aiBreathDelay = -1;
        }
        // AI 轉身:依 aiSkill 機率記得蹬牆(幼幼檔 AI 常慢轉=轉身是追過牠的機會)
        if (this.turnWindowOpen(this.opp)) {
          if (this.opp.aiTurnRoll < 0) {
            this.opp.aiTurnRoll = Math.random();
            this.opp.aiTurnDelay = preset.turnWindow * 0.35;
          }
          this.opp.aiTurnDelay -= delta;
          if (this.opp.aiTurnDelay <= 0 && !this.opp.turnArmed && this.opp.aiTurnRoll < preset.aiSkill + 0.12) {
            this.opp.turnArmed = true;
          }
        } else {
          this.opp.aiTurnRoll = -1;
        }
      }

      // —— 幼幼 assist 自動換氣(窗開 0.35 秒仍沒按=幫孩子換;判定=畫面:窗還是那個窗) ——
      if (preset.assistBreath) {
        for (const r of duel ? [this.p1, this.opp] : [this.p1]) {
          if (!r.finished && this.breathWindowOpen(r)) {
            const inWinT = r.air <= 0.02 ? r.airEmptyT : r.breathCycleT - preset.breathEvery;
            if (inWinT >= 0.35) this.pressBreath(r);
          }
        }
      }

      // —— 物理:水阻滑行衰減+氣量+趟數+轉身+觸壁 ——
      for (const r of [this.p1, this.opp]) {
        if (!r.node.visible && r !== this.p1) continue;
        if (r.finished) {
          r.speed = Math.max(0, r.speed - delta * 2); // 觸壁後滑行收速
        } else {
          r.speed *= Math.max(0, 1 - BASE_DRAG * delta);
          // ★氣量:緩慢下降;見底=強制慢速(溫柔:仍游得動)直到成功換氣
          r.air = Math.max(0, r.air - preset.airDrain * delta);
          r.breathCycleT += delta;
          if (r.air <= 0.02) {
            r.airEmptyT += delta;
            r.speed = Math.min(r.speed, preset.maxSpeed * FORCED_SLOW_MUL);
            if (r === this.p1 && !r.lowAirWarned) {
              r.lowAirWarned = true;
              this.message = "沒氣了——游不快!換氣窗常開,快按 S 換氣!";
              this.emitEvent("air-empty", { who: r.label });
            }
          } else {
            r.airEmptyT = 0;
            if (r === this.p1 && r.air <= AIR_LOW && !r.lowAirWarned) {
              r.lowAirWarned = true;
              this.emitEvent("air-low", { who: r.label });
              this.message = "氣快用完了——把握下個綠色換氣窗!";
            }
            if (r.air > AIR_LOW) r.lowAirWarned = false;
          }
          // 換氣窗剛過沒按=重啟週期(錯過就等下一個窗,不懲罰)
          if (r.air > 0.02 && r.breathCycleT > preset.breathEvery + preset.breathWindow) {
            r.breathCycleT = 0;
          }
        }
        r.stumbleT = Math.max(0, r.stumbleT - delta);
        r.chokeT = Math.max(0, r.chokeT - delta);
        r.breathAnimT = Math.max(0, r.breathAnimT - delta);
        r.turnFlashT = Math.max(0, r.turnFlashT - delta);
        r.turnSlowT = Math.max(0, r.turnSlowT - delta);

        // 里程推進+碰壁轉身結算(跨越 50m 倍數=碰壁瞬間)
        const prevLeg = Math.floor(r.dist / POOL_LEN);
        r.dist += r.speed * delta;
        const newLeg = Math.floor(r.dist / POOL_LEN);
        const crossedWall = newLeg !== prevLeg && (this.mode.endless || newLeg * POOL_LEN < this.finishDist);
        if (crossedWall && !r.finished) this.resolveTurn(r);

        r.strideT += delta * (0.35 + r.speed * 0.22);
        r.kickT = (r.kickT ?? 9) + delta;
        // 趟數
        const lap = Math.min(this.mode.endless ? Infinity : this.laps, Math.floor(r.dist / POOL_LEN) + 1);
        if (lap !== r.lap) {
          r.lap = lap;
          if (r === this.p1) {
            if (this.mode.endless) {
              this.emitEvent("lap", { lap });
              this.message = `第 ${lap} 趟——節奏越來越穩!`;
            } else if (lap === this.laps && !this.lastLapAnnounced) {
              this.lastLapAnnounced = true;
              this.emitEvent("last-lap", {});
              this.message = "最後一趟——衝回出發壁!";
            }
          }
        }
        // 觸壁完賽
        if (!this.mode.endless && !r.finished && r.dist >= this.finishDist) {
          r.finished = true;
          r.finishTime = this.elapsed;
          const pf = pathPoint(this.finishDist - 0.2, r.lane);
          this.splash.spawn(pf.x, pf.z, 1, this.time);
          if (this.phase !== "ended") this.finishRace(r);
        }
      }

      // —— 轉身窗/換氣窗進出提示(P1;判定=畫面:HUD 綠窗與這裡同一個函式) ——
      const turnOpen = this.turnWindowOpen(this.p1);
      if (turnOpen && !this._turnWasOpen) {
        this.emitEvent("turn-window", { first: !this._turnHintShown });
        this._turnHintShown = true;
        if (!this.p1.turnArmed) this.message = "接近池壁——綠窗亮了,按 W 蹬牆轉身!";
      }
      this._turnWasOpen = turnOpen;
      const breathOpen = this.breathWindowOpen(this.p1);
      if (breathOpen && !this._breathWasOpen) {
        this.emitEvent("breath-window", { first: !this._breathHintShown });
        this._breathHintShown = true;
        if (this.p1.air > AIR_LOW) this.message = "綠色換氣窗亮了——按 S 側頭換氣!";
      }
      this._breathWasOpen = breathOpen;

      // —— 超越偵測(競速) ——
      if (this.mode.race && this.phase === "swimming") {
        const gapSign = Math.sign(this.p1.dist - this.opp.dist);
        if (gapSign !== 0 && this.lastGapSign !== 0 && gapSign !== this.lastGapSign && Math.abs(this.p1.dist - this.opp.dist) > 0.2) {
          this.emitEvent("overtake", { ahead: gapSign > 0 });
          this.message = gapSign > 0 ? "超越!游到前面去了!" : "被追過了——加緊節奏追回來!";
        }
        if (gapSign !== 0) this.lastGapSign = gapSign;
      }
    } else if (!paused && this.phase === "gate") {
      if (this.input.consumePress("p1left") || this.input.consumePress("p1right")
        || this.input.consumePress("p2left") || this.input.consumePress("p2right")) {
        this.beginRace();
      }
    }

    // 彩花
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    // 水環境每幀刷新(water-kit:水面頂點波+水道繩浮球+水花粒子——全用同一個波高場)
    this.water.update(this.time);
    for (const rope of this.laneRopes) rope.update(this.time);
    this.splash.update(delta, this.time);

    this.poseSwimmer(this.p1);
    this.poseSwimmer(this.opp);
    this.animateHead(this.p1); // idle 生動(選單/出發前)
    this.animateHead(this.opp);
    this.animateCrowd(); // 觀眾舉手歡呼+左右看
    this.placeRacer(this.p1);
    this.placeRacer(this.opp);
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot") && this.phase === "gate") this.beginRace();
  }

  // ---------- 擺位與動畫 ----------
  placeRacer(r) {
    const p = pathPoint(r.dist, r.lane);
    r.node.position.set(p.x, 0, p.z);
    r.node.rotation.y = Math.atan2(p.tx, p.tz); // 轉身處 tx 翻轉=朝向自動翻
    // 浮力:黏在浪上(water-kit applyBuoyancy;sink=0.55 任務拍板,俯臥補償在 PRONE_Y)
    applyBuoyancy(r.buoy, p.x, p.z, this.time, { phase: r.bobPhase, sink: 0.55, bobAmp: 0.045, tiltMul: 0.5 });
  }

  poseSwimmer(r) {
    const f = r.figure;
    if (!r.node.visible) return;
    if (this.phase === "menu" || this.phase === "gate" || (this.phase === "ended" && r.speed < 0.3)) {
      poseSwimmerFloatIdle(f);
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const glide = clamp(r.speed / Math.max(preset.maxSpeed, 0.1), 0, 1);
    const cyc = r.strideT * Math.PI * 2;
    const kick = Math.max(0, 1 - (r.kickT ?? 9) / 0.34); // 划水瞬間的爆發相
    f.torso.rotation.x = 0.04 + kick * 0.05;
    f.rig.position.y = 0;
    // ★自由式雙臂交替風車划水:左右相位差 π;入水那隻手(kickSide)加爆發
    const arms = [[f.leftArm, 0, -1], [f.rightArm, Math.PI, 1]];
    for (const [arm, ph, sideSign] of arms) {
      const a = cyc + ph;
      const isKickArm = (r.kickSide === "L" && sideSign < 0) || (r.kickSide === "R" && sideSign > 0);
      const kb = isKickArm ? kick : 0;
      arm.pivot.rotation.x = a % (Math.PI * 2); // 連續風車(俯臥後=矢狀面大迴環)
      arm.pivot.rotation.z = sideSign * (0.14 + kb * 0.1);
      arm.joint.rotation.x = -0.35 - Math.max(0, Math.sin(a)) * 0.55 - kb * 0.2;
    }
    // 身體滾轉(自由式 body roll,跟著划水相位)——rig.rotation.y 在俯臥後=繞身體長軸滾
    f.rig.rotation.y = Math.sin(cyc) * (0.2 + glide * 0.12);
    // ★打腿:小幅高頻交替(自由式六拍腿感)
    const legs = [[f.leftLeg, 0], [f.rightLeg, Math.PI]];
    for (const [leg, ph] of legs) {
      const s = Math.sin(cyc * 3 + ph);
      leg.pivot.rotation.x = s * 0.22;
      leg.pivot.rotation.z = 0;
      leg.joint.rotation.x = Math.max(0, -s) * 0.3 + 0.05;
    }
    // ★頭:預設臉朝水面;換氣=側頭(判定=畫面:換氣成功看得到側頭動作)
    if (r.breathAnimT > 0) {
      const w = Math.sin(Math.min(1, r.breathAnimT / 0.8) * Math.PI);
      f.headGroup.rotation.set(-0.15 * w, r.breathSide * 1.05 * w, 0);
    } else if (r.chokeT > 0) {
      // 嗆水:抬頭咳嗽+微抖(溫柔的視覺回饋)
      const w = r.chokeT / 0.9;
      f.headGroup.rotation.set(-0.7 * w + Math.sin(this.time * 16) * 0.06 * w, 0, 0);
    } else {
      f.headGroup.rotation.set(-0.18, 0, 0); // 微抬臉(看得到有臉,不整顆埋水裡)
    }
    // 划亂/嗆水:手臂亂拍水
    if (r.stumbleT > 0 || r.chokeT > 0) {
      const w = Math.max(r.stumbleT / STUMBLE_DUR, r.chokeT / 0.9);
      f.leftArm.pivot.rotation.z = -0.5 * w + Math.sin(this.time * 18) * 0.3 * w;
      f.rightArm.pivot.rotation.z = 0.5 * w - Math.sin(this.time * 18) * 0.3 * w;
    }
    // 蹬牆轉身瞬間:抱膝翻滾感(短促壓縮)
    if (r.turnFlashT > 0) {
      const w = r.turnFlashT / 0.7;
      f.torso.rotation.x = 0.6 * w;
      for (const [leg] of legs) {
        leg.pivot.rotation.x = -1.1 * w;
        leg.joint.rotation.x = 1.5 * w;
      }
    }
  }

  updateCamera(delta) {
    if (this.freeCam) return; // 驗證用:凍結自動運鏡
    const r = this.p1;
    const p = pathPoint(r.dist, r.lane);
    const duel = this.modeId === "duel2p";
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      const a = this.time * 0.07;
      desiredPos = new THREE.Vector3(Math.cos(a) * 40, 13, Math.sin(a) * 26);
      desiredLook = new THREE.Vector3(0, 0.5, 0);
    } else if (this.cameraView === 0) {
      // 跟隨:泳者後上方;雙人/競速時拉遠看兩人
      let cx = p.x;
      let cz = p.z;
      let back = 7.6;
      let up = 3.6;
      if (duel || (this.mode.race && this.opp.node.visible)) {
        const q = pathPoint(this.opp.dist, this.opp.lane);
        const gap = Math.min(26, Math.hypot(p.x - q.x, p.z - q.z));
        if (duel) {
          cx = (p.x + q.x) / 2;
          cz = (p.z + q.z) / 2;
        }
        back = 7.6 + gap * 0.35;
        up = 3.6 + gap * 0.18;
      }
      desiredPos = new THREE.Vector3(cx - p.tx * back, up, cz - p.tz * back + 2.2);
      desiredLook = new THREE.Vector3(cx + p.tx * 6, 0.2, cz + p.tz * 6);
    } else if (this.cameraView === 1) {
      desiredPos = new THREE.Vector3(p.x, 3.6, p.z + 11);
      desiredLook = new THREE.Vector3(p.x, 0.1, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 2, 26, p.z + 2);
      desiredLook = new THREE.Vector3(p.x + p.tx * 6, 0, p.z);
    } else if (this.cameraView === 3) {
      // 貼水面:低角度看划水水花
      desiredPos = new THREE.Vector3(p.x - p.tx * 2.6, 0.75, p.z - 1.9);
      desiredLook = new THREE.Vector3(p.x + p.tx * 10, 0.1, p.z);
    } else {
      desiredPos = new THREE.Vector3(p.x, 3.6, p.z - 11);
      desiredLook = new THREE.Vector3(p.x, 0.1, p.z);
    }
    const k = 1 - Math.exp(-delta * 3.4);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // 小地圖資料(泳池外框+雙泳者;直線來回)
  getMinimapData() {
    if (!this._miniPath) {
      const hx = POOL_LEN / 2;
      const hz = POOL_HALF_W;
      this._miniPath = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    }
    const me = pathPoint(this.p1.dist, this.p1.lane);
    const opp = this.opp.node.visible ? pathPoint(this.opp.dist, this.opp.lane) : null;
    return {
      path: this._miniPath,
      me: [me.x, me.z],
      opp: opp ? [opp.x, opp.z] : null,
      finish: [-POOL_LEN / 2, this.p1.lane],
    };
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const duel = this.modeId === "duel2p";
    const phaseLabels = { menu: "主選單", gate: "出發線", swimming: "游泳中", ended: "完賽" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    const swimming = this.phase === "swimming";
    const racing = this.mode.race && (swimming || this.phase === "ended");
    let rankText = "—";
    if (racing) {
      const lead = this.p1.dist >= this.opp.dist;
      rankText = duel ? (lead ? "P1 領先" : "P2 領先") : lead ? "第 1 位" : "第 2 位";
    } else if (this.mode.endless && swimming) {
      rankText = `第 ${this.p1.lap} 趟`;
    }
    const nextSide = this.p1.lastSide === "L" ? "右 D▶" : this.p1.lastSide === "R" ? "左 ◀A" : "任一側";
    const breathOpen = this.breathWindowOpen(this.p1);
    const turnOpen = this.turnWindowOpen(this.p1);
    this.onHudUpdate({
      rankText,
      lapText: this.mode.endless ? `${this.p1.lap}` : `${Math.min(this.p1.lap, this.laps || preset.trips)}/${this.laps === Infinity ? "∞" : (this.laps || preset.trips)}`,
      timeText: `${mins}:${secs}`,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.p1.speed / preset.maxSpeed, 0, 1),
      speedText: `${this.p1.speed.toFixed(1)} m/s`,
      rhythm01: this.p1.rhythm01,
      nextSide,
      lastResult: this.p1.lastResult,
      // ★換氣(判定=畫面:HUD 綠窗=breathWindowOpen 同一函式)
      air01: this.p1.air,
      airLow: this.p1.air <= AIR_LOW,
      breathOpen,
      // ★轉身
      turnOpen,
      turnArmed: this.p1.turnArmed,
      choking: this.p1.chokeT > 0,
      stumble: this.p1.stumbleT > 0,
      swimming,
      duel,
      race: !!this.mode.race,
      gapText: racing
        ? (this.p1.dist >= this.opp.dist
          ? `領先 ${(this.p1.dist - this.opp.dist).toFixed(0)} m`
          : `落後 ${(this.opp.dist - this.p1.dist).toFixed(0)} m`)
        : "—",
      p2SpeedText: duel ? `${this.opp.speed.toFixed(1)} m/s` : null,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestTime: prev.bestTime, bestWin: prev.bestWin };
    if (this.phase === "ended" && !this.mode.endless && this.p1.finished) {
      const better = prev.bestTime === undefined || this.p1.finishTime < prev.bestTime;
      if (better) {
        snapshot.bestTime = this.p1.finishTime;
        snapshot.bestWin = true;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestTime !== undefined
      ? `最佳成績:${snap.bestTime.toFixed(1)} 秒觸壁——挑戰它!`
      : "尚無最佳成績,先游一場吧!";
    this.pushHud();
    return true;
  }
}
