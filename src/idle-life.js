// idle-life.js — 3D 人物「idle 生動」drop-in 輔助(零相依 ES module)
// ---------------------------------------------------------------------------
// 用途:讓靜止/比賽中的 3D 人物不死板——主角偶爾平滑轉頭看一下+咧嘴微笑;
//       觀眾平常小幅晃動聊天,**得分那一刻**高舉雙手、張大嘴歡呼,相位錯開成「人浪」。
//       純吃 time+強度(不用 Math.random,故決定性、可重播),只讀寫既有物件的
//       rotation/scale/position。
//
// THREE 由呼叫端自己建幾何(本檔不 import three,也不需要)——這幾支函式只操作
// 呼叫端傳進來的既有 Object3D/Mesh(headGroup.rotation.y、smile.scale、
// arm.pivot.rotation…),所以任何 three 版本都能用。
//
// ★整合者要自己做的一件事:把「頭+臉」群組成一個 headGroup(樞紐=頭中心),
//   這樣轉頭時整顆頭連臉一起轉(而不是只轉頭球、五官不跟)。因遊戲的人物工廠
//   而異,故不代勞。最小範例(座標僅示意,照你的人物尺寸調):
//
//     const headGroup = new THREE.Group();
//     headGroup.position.set(0, HEAD_CENTER_Y, 0); // 樞紐放在頭中心
//     torso.add(headGroup);                          // 掛在會前傾的軀幹樞紐上
//     const H = (y) => y - HEAD_CENTER_Y;            // 原立姿 y → headGroup 局部
//     head.position.y  = H(HEAD_CENTER_Y);           // 頭球
//     eyeL.position.y  = H(EYE_Y);   eyeR.position.y = H(EYE_Y);   // 眼(含瞳)
//     browL.position.y = H(BROW_Y);  browR.position.y = H(BROW_Y); // 眉
//     smile.position.y = H(MOUTH_Y);                 // 嘴(idle 會放大它)
//     earL/earR/hairCap/hairBack …                   // 耳、髮/帽後緣一併收進 headGroup
//     headGroup.add(head, eyeL, eyeR, pupilL, pupilR, browL, browR, smile, earL, earR, hairCap, hairBack);
//   ——H(y)+HEAD_CENTER_Y = y,所以群組化前後視覺位置逐一相同(不會位移)。
//   髮/帽後緣的 phi 用下方 EAR_SAFE_PHI(耳前無髮鐵律)。
// ---------------------------------------------------------------------------

// 耳前無髮鐵律:髮片/帽後緣的 SphereGeometry 只覆蓋「耳後」半球——
// phiStart=1.06π、phiLength=(1.94−1.06)π=0.88π,兩側前緣一律留在耳朵之後(z<0),
// 露出臉頰與耳前緣。用法:new THREE.SphereGeometry(r, w, h, EAR_SAFE_PHI.start, EAR_SAFE_PHI.end - EAR_SAFE_PHI.start, thetaStart, thetaLength)
export const EAR_SAFE_PHI = { start: 1.06 * Math.PI, end: 1.94 * Math.PI };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// smoothstep 梯形:t 在 [0,hold] 內用 ramp 秒緩起、中段停留=1、ramp 秒緩收 → 0,其餘為 0
function trapezoid(t, hold, ramp) {
  if (t < 0 || t >= hold) return 0;
  const r = Math.min(ramp, hold / 2); // hold 很短時不讓 rise/fall 重疊
  let raw = 1;
  if (t < r) raw = t / r;
  else if (t > hold - r) raw = (hold - t) / r;
  raw = clamp01(raw);
  return raw * raw * (3 - 2 * raw); // smoothstep
}

// animateIdleHead:每幀呼叫。讓整顆頭(headGroup)每隔 period 秒,平滑往一側「看一下」
//   (rotation.y → yaw)+ 嘴角笑弧短暫放大(smileMesh.scale → smile),再平滑回正。
//   平滑靠 lerp(絕不瞬跳);各角色傳不同 phase/period 就會錯開、不整齊劃一。
//   headGroup / smileMesh 缺任一都安全略過。
//   opts:phase 相位偏移(秒,各角色錯開)、period 週期(秒)、hold 看的視窗長度(秒,
//         含緩起緩收)、yaw 轉頭幅度(rad,可大如 0.6)、smile 微笑放大倍率(如 1.4)。
export function animateIdleHead(headGroup, smileMesh, time, opts = {}) {
  if (!headGroup) return;
  const { phase = 0, period = 5.6, hold = 1.6, yaw = 0.6, smile = 1.4 } = opts;
  const t = ((time + phase) % period + period) % period; // 保險:負 time 也落在 [0,period)
  const k = trapezoid(t, hold, 0.3);
  const targetYaw = yaw * k;
  headGroup.rotation.y += (targetYaw - headGroup.rotation.y) * 0.15; // lerp 回正,不瞬跳
  if (smileMesh) {
    const targetS = 1 + (smile - 1) * k;
    smileMesh.scale.x += (targetS - smileMesh.scale.x) * 0.15;
    smileMesh.scale.y += (targetS - smileMesh.scale.y) * 0.15;
  }
}

// ── 歡呼強度(事件驅動)────────────────────────────────────────────────────
// makeCheerState:管理「得分那一刻爆發、之後衰退」的 0~1 強度。
//   ⚠⚠ 為什麼非要它不可(2026-08-28 使用者退件的病根):舊版 animateCrowdCheer
//   只吃 time ⇒ 觀眾**從頭到尾一直在高舉雙手**。看起來很熱鬧,但「進球」與
//   「沒進球」畫面**完全一樣** —— 使用者要的是「當有人進球時」歡呼,恆定人浪
//   反而把那一刻抹平了。這與 0827 sheepflock3d「按 J 跟按 K 動作上沒有差別」
//   是同一種病:動了,但沒有**差別**。
//   用法:建一次存在 this.cheer;得分時 .trigger(強度);每幀 .step(dt) 再餵給 animateCrowdCheer。
//     this.cheer = makeCheerState();
//     onPot() { this.cheer.trigger(1); audio.crowdCheer(1); }   // 畫面與聲音同一刻
//     update(dt) { animateCrowdCheer(this.crowdFigures, t, { cheer: this.cheer.step(dt) }); }
//   opts:decay 每秒衰退量(預設 0.45 ⇒ 從 1 衰到 0 約 2.2 秒,與 audio.crowdCheer
//         的 2.6 秒喝采浪相稱——畫面比聲音早一點收,不會出現「沒聲音了還在舉手」)。
export function makeCheerState(opts = {}) {
  const { decay = 0.45 } = opts;
  return {
    v: 0,
    // trigger:取 max 不是相加——連續進球時不會累積成 3.0 然後卡在高原好幾秒。
    trigger(strength = 1) { this.v = Math.max(this.v, clamp01(strength)); return this.v; },
    step(dt = 1 / 60) { this.v = Math.max(0, this.v - dt * decay); return this.v; },
    /* stepAt:吃「累計時間」而不是 dt,自己算差值。
       為什麼要它:廣佈到既有各站時,`animateCrowdCheer(this.crowdFigures, this.time)`
       的呼叫點**不一定拿得到 dt**(有的站那裡只有 this.time / t)。有了它,接線就變成
       純文字取代、不必逐站去看作用域裡有沒有 dt。
       ⚠ 夾住 0.25 秒:分頁切回前景時 time 會一次跳很多,不夾的話歡呼會被一口氣扣光。 */
    stepAt(now) {
      const prev = this._t === undefined ? now : this._t;
      this._t = now;
      return this.step(Math.min(0.25, Math.max(0, now - prev)));
    },
    get value() { return this.v; },
  };
}

/* crowdCheer:懶建立 + 取得某個遊戲實例的歡呼強度狀態。
   讓「得分那一刻」的接線在 game.js / main.js 兩邊都只要一行,不必先在建構子加欄位
   ——廣佈到 20+ 個既有 repo 時,少一個要對的錨點就少一種失敗。
     得分:crowdCheer(game).trigger(0.9)
     每幀:animateCrowdCheer(figs, t, { cheer: crowdCheer(this).stepAt(t) }) */
export function crowdCheer(owner) {
  if (!owner) return makeCheerState();          // 沒有 owner 也不炸(回傳一個孤兒狀態)
  return owner.__cheer || (owner.__cheer = makeCheerState());
}

// animateCrowdCheer:每幀呼叫。驅動一整排觀眾——
//   ①雙臂 armDown→armUp 循環擺動(歡呼時才真的高舉過頭)②頭左右緩擺看比賽
//   ③隨歡呼微微踮起 ④**表情會動**:嘴由「寬扁微笑」隨節奏張成「O 嘴」、眉上揚、瞳孔放大。
//   各人用自己的 phase 錯開 → 此起彼落的人浪(不整齊劃一)。只改 rotation/scale/position,
//   不建新幾何、不配置物件(每幀呼叫,零 GC 壓力)。
//
//   crowdFigs:[{ fig, phase, rigY }] —— fig=人偶,以下欄位**缺哪個就略過哪段**:
//     headGroup(轉頭)/ leftArm+rightArm({pivot,joint})(舉手)/ rig(踮起)/
//     smile(嘴,新增)/ brows(眉,新增)/ eyes(眼白,新增)/ pupils(瞳,新增)
//     ——後四者都吃 {l,r} 或 [l,r] 兩種寫法。
//   ⚠ smile/brows/pupils 是**新增的可選欄位**:既有 18 站的 _makePerson 只回傳
//     {rig, headGroup, smile, leftArm, rightArm} ⇒ smile 立刻生效、brows/pupils 靜默略過。
//     要眉毛與瞳孔也動,在該站的人物工廠把 bL/bR、pL/pR 一併回傳即可(不改本檔)。
//
//   opts:
//     cheer     0~1 事件強度(makeCheerState().step(dt) 餵進來)。0=平常、1=剛得分。
//     baseline  平常的底噪強度(預設 0.34)——觀眾不是雕像,也不該一直在狂歡。
//     armDown/armUp  手臂放下/高舉的 pivot.rotation.x(rad,越負舉越高;-π≈正上方)
//     stayUp    歡呼時手臂「泵動的下限」佔比(預設 0.75)——見下方⚠②
//     headSwing 頭左右擺幅(rad)、hopUp 踮起最大位移(m)
//     mouthOpen 歡呼時嘴巴最大張開倍率(y 方向;x 同時收窄成 O 形)
//   ⚠① 嘴巴用**當下 scale 當基準再乘倍率**(第一次呼叫時記進 c._m0),不寫死絕對值——
//     各站的 smile 基準 scale 不同(curling3d 是 1.5/0.6/0.6),寫死會把別站的臉改壞。
//   ⚠② **stayUp:歡呼時手不可以盪回身側**(2026-08-28 使用者退件:「手舉的不夠高,
//     手要高舉過頭」)。舊版 raise 是完整的 0→1 正弦 ⇒ 每個週期手都會**整隻放回大腿邊**,
//     十二個人相位錯開的結果是「隨時都有一半的人手是放下的」,看起來就不像在歡呼。
//     改成:強度越高、擺動的**下限**跟著抬起(lo = amp²×stayUp)⇒ cheer=1 時手在
//     頭頂上方 132°~166° 之間泵動,一次都不會放下;平常(amp=0.34)lo≈0.09,仍是自然垂擺。
//   ⚠③ **手臂長度是各站人物工廠的事,不是本檔**:肩在 y=1.22、手臂總長 0.38 的話,
//     指尖只到 1.60 = **剛好齊頭頂**(billiards3d 首版實測)⇒ 再怎麼轉都不會「過頭」。
//     要真的過頭,工廠端的上臂+前臂總長需 ≥0.5(肩 1.22 + 0.5 = 1.72 > 頭頂 1.60)。
export function animateCrowdCheer(crowdFigs, time, opts = {}) {
  if (!crowdFigs) return;
  const {
    armDown = -0.5, armUp = -3.02, headSwing = 0.42, hopUp = 0.06,
    cheer = 0, baseline = 0.34, mouthOpen = 3.2, stayUp = 0.75,
  } = opts;
  const amp = baseline + (1 - baseline) * clamp01(cheer); // 總強度:平常 baseline、得分衝到 1
  const span = armDown - armUp;              // 手臂全幅(常數)
  const rate = 2.4 + clamp01(cheer) * 2.4;   // 歡呼時擺得更快(2.4 → 4.8 rad/s)
  const lo = amp * amp * stayUp;             // ⚠② 擺動下限:歡呼時手停在頭上,不放下
  for (const c of crowdFigs) {
    const f = c && c.fig;
    if (!f) continue;
    const ph = c.phase || 0;
    // 慢頻左右看:歡呼時擺幅加大(看向得分的地方、彼此對看)
    if (f.headGroup) f.headGroup.rotation.y = Math.sin(time * 0.9 + ph) * headSwing * (0.6 + 0.8 * amp);
    const wave = Math.sin(time * rate + ph) * 0.5 + 0.5;   // 0..1 正弦
    const raise = lo + (1 - lo) * wave * amp;              // 0(垂放)→1(直舉過頭)
    const lift = armDown - raise * span;
    /* 舉越高手臂越直(肘打開)、外張成 V 字。
       ⚠⚠ **splay 的正負號要由肩膀自己的 x 決定,不可寫死**(2026-08-28 實機量到的錯):
         Euler 預設序 'XYZ' ⇒ 對向量先套 Rz 再套 Rx;Rz(θ) 把向下的 (0,-1,0) 轉成
         (sinθ, -cosθ, 0) ⇒ **θ 為正 = 往 +x 倒**。舊版寫死 leftArm=+0.22、rightArm=-0.22,
         而 leftArm 的肩在 x=-0.16 ⇒ 它往 +x(身體中線)倒、右臂往 -x 倒 ⇒ **兩手在頭頂交叉**。
         手短又舉不高時看不出來;手加長、舉直之後就變成「雙手抱頭」而不是歡呼
         (實機量到兩手間距只剩 0.035m,而頭寬 0.239m)。
       ⇒ 用 sign(pivot.position.x) 推正負,任何命名/擺位的人物工廠都會對。 */
    const elbow = -0.12 * (1 - raise);
    const splay = 0.22 + 0.14 * raise;
    const outward = (arm) => splay * (Math.sign(arm.pivot.position?.x ?? 0) || 1); // 往身體外側倒
    if (f.leftArm) { f.leftArm.pivot.rotation.x = lift; f.leftArm.pivot.rotation.z = outward(f.leftArm); f.leftArm.joint.rotation.x = elbow; }
    if (f.rightArm) { f.rightArm.pivot.rotation.x = lift; f.rightArm.pivot.rotation.z = outward(f.rightArm); f.rightArm.joint.rotation.x = elbow; }
    if (f.rig) f.rig.position.y = (c.rigY || 0) + raise * hopUp * amp; // 舉高時微微踮起
    /* ── 表情:嘴由寬扁微笑張成 O 嘴 ────────────────────────────────────────
       ⚠ 臉用**自己的節奏**,不跟著手臂的 raise 走(2026-08-28 修):
         手改成「停在頭上泵動」後 raise 只在 0.75~1 之間跑,綁在它上面的嘴巴就只剩
         20% 變化 ⇒ 看起來像一張凍住的 O 嘴。而且人本來就是**持續在喊**、和舉手
         不同拍子。⇒ 臉走 rate×1.35 的獨立波、相位也錯開(ph×1.7),
         歡呼時在 0.35~1.0 之間開合,平常則是小幅說笑。 */
    const faceWave = Math.sin(time * rate * 1.35 + ph * 1.7) * 0.5 + 0.5;
    const open = amp * (0.35 + 0.65 * faceWave);      // 0=閉合微笑 → 1=張到最大
    if (f.smile) {
      if (!c._m0) c._m0 = { x: f.smile.scale.x, y: f.smile.scale.y, z: f.smile.scale.z }; // 記基準,只記一次
      f.smile.scale.set(
        c._m0.x * (1 - 0.42 * open),                  // 橫向收窄
        c._m0.y * (1 + (mouthOpen - 1) * open),       // 縱向張開
        c._m0.z * (1 + 0.35 * open),                  // 略前凸,側面看得出來在喊
      );
    }
    // 眉毛上揚(可選;{l,r} 或 [l,r] 都吃)——挑眉是「興奮」最好讀的一筆
    const brows = f.brows && (f.brows.l ? [f.brows.l, f.brows.r] : f.brows);
    if (brows) {
      const up = open;   // 與嘴同一條臉的節奏(挑眉與張嘴同拍才像在喊)
      for (let i = 0; i < 2; i++) {
        const b = brows[i]; if (!b) continue;
        if (b.userData._y0 === undefined) b.userData._y0 = b.position.y; // 記基準,只記一次
        b.position.y = b.userData._y0 + up * 0.034;
        b.rotation.z = (i === 0 ? 1 : -1) * up * 0.30; // 外端上挑=興奮
      }
    }
    // 眼睛睜大(可選)——與挑眉一起才讀得出「開心」,只放大瞳孔會變成「驚嚇」
    const eyes = f.eyes && (f.eyes.l ? [f.eyes.l, f.eyes.r] : f.eyes);
    if (eyes) {
      const k = 1 + open * 0.28;
      for (const e of eyes) { if (e) e.scale.set(k, k, k); }
    }
    // 瞳孔放大(可選)——眼睛「亮起來」,遠看是最容易讀到的情緒訊號
    const pupils = f.pupils && (f.pupils.l ? [f.pupils.l, f.pupils.r] : f.pupils);
    if (pupils) {
      const k = 1 + open * 0.45;
      for (const p of pupils) { if (p) p.scale.set(k, k, k); }
    }
  }
}
