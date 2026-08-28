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
/* ── 手臂長度自動補足(2026-08-28)────────────────────────────────────────────
   問題:「舉高過頭」不是角度問題是**長度**問題,而各站觀眾的尺度天差地遠
   (實測肩高 0.37~1.72、上臂 0.13~0.30 都有)⇒ 沒有一組通用的數字可以寫死,
   逐站手改 15 個 repo 又脆弱又會漏。
   解法:第一次驅動時**自己量一次**,不夠長就把手臂沿自身軸拉長(只改 pivot.scale.y,
   不動幾何、不需要 import three)。之後每幀都是純動畫,零成本。

   量法(全部在 rig 的局部座標,單位一致,不必管各站縮放):
     手臂垂放時往下延伸多少 = 沿著 pivot 底下最深的鏈累加 position.y,再減末端半長
     頭頂高度            = headGroup.position.y + 頭部件裡最高的 (position.y + 半徑)
     舉直時指尖高度       = pivot.position.y + 手臂長度
   指尖低於「頭頂 + margin」就放大,倍率夾在 [1, 2.4](夾住是為了:量錯時寧可
   不夠長,也不要生出一雙掃到地板的手)。 */
function chainDrop(node) {          // 回傳鏈往下最遠的局部 y(負值)
  let deepest = 0;
  const walk = (o, acc) => {
    if (!o) return;
    const y = acc + (o.position ? o.position.y : 0);
    const p = o.geometry && o.geometry.parameters;
    const half = p ? (p.length || p.height || 0) / 2 + (p.radius || 0) : 0;
    if (y - half < deepest) deepest = y - half;
    if (o.children) for (const ch of o.children) walk(ch, y);
  };
  if (node && node.children) for (const ch of node.children) walk(ch, 0);
  return deepest;
}
function chainRise(node) {          // 回傳鏈往上最遠的局部 y(正值)
  let top = 0;
  const walk = (o, acc) => {
    if (!o) return;
    const y = acc + (o.position ? o.position.y : 0);
    const p = o.geometry && o.geometry.parameters;
    const half = p ? (p.length || p.height || 0) / 2 + (p.radius || 0) : 0;
    if (y + half > top) top = y + half;
    if (o.children) for (const ch of o.children) walk(ch, y);
  };
  if (node && node.children) for (const ch of node.children) walk(ch, 0);
  return top;
}
export function fitArmReach(fig, margin) {
  const arms = [fig && fig.leftArm, fig && fig.rightArm].filter((a) => a && a.pivot && a.pivot.position && a.pivot.scale);
  // ⚠ 量不到就什麼都不做(回傳 1)——headGroup/position 缺一不可。
  //   本檔的契約是「缺哪個就略過哪段」,不可以因為量不到就拋例外把整個迴圈打斷。
  const head = fig && fig.headGroup;
  if (!arms.length || !head || !head.position) return 1;
  const headRise = chainRise(head);                          // ≈ 頭半徑(含帽)
  const headTop = head.position.y + headRise;
  /* ⚠ margin 預設**跟著頭的大小按比例**,不是絕對值:實測各站觀眾大小差三倍
     (肩高 0.37~1.72),寫死 0.12 對小人偶是「舉超高」、對大人偶等於沒留餘裕。
     0.8×頭半徑 ≈ 「指尖比頭頂高出大半顆頭」,在任何尺度下看起來都是高舉過頭。 */
  if (margin === undefined) margin = (headRise || 0.16) * 0.8;
  let scale = 1;
  for (const arm of arms) {
    const len = -chainDrop(arm.pivot);                       // 手臂總長(正值)
    if (!(len > 0)) continue;                                // 量不到長度(沒有幾何)就跳過
    const need = headTop + margin - arm.pivot.position.y;     // 舉直要達到的長度
    const k = need / len;
    if (k > scale) scale = k;
  }
  if (!Number.isFinite(scale)) return 1;
  scale = Math.min(2.4, Math.max(1, scale));
  if (scale > 1.001) for (const arm of arms) arm.pivot.scale.y = scale;
  return scale;
}

/* face-discover.js — 從 headGroup **自己認出**眉/眼/瞳(零相依,不 import three)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 為什麼要有這一支
 * ─────────────────────────────────────────────────────────────────────────────
 * `animateCrowdCheer` 的 `brows / eyes / pupils` 是可選欄位:人物工廠回傳了就會動,
 * 沒回傳就靜默略過。2026-08-28 實測:**19 站的嘴都會動了,但眉/眼/瞳全部沒回傳**
 * —— 每一站的臉其實都做好了(眼白、瞳孔、眉毛的 mesh 都在),只是變數名各不相同
 * (`eyeL/eyeR`、`bL/bR`、`browL/browR`…),`return { ... }` 沒帶它們出來。
 *
 * 原本的做法是「逐站去改人物工廠的 return」——19 站只有 3 站長得一樣,
 * 而人物工廠是全檔最敏感的地方(改壞=人臉爛掉),**硬套一定出事**。
 *
 * ⇒ 改成:引擎在第一次驅動這個人偶時,**掃一遍 headGroup、用結構特徵把五官認出來**
 *   (同 `fitArmReach` 的「量一次、之後每幀純動畫」範式)。
 *   認得出來就動,認不出來就維持原本的靜默略過 —— **寧可少做,也不要認錯**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 怎麼認(全部是結構特徵,不靠變數名)
 * ─────────────────────────────────────────────────────────────────────────────
 * ① 只認**左右鏡像成對**的 mesh:x 相反、y/z 相同、大小相近。
 *    ⇒ 嘴(單顆)、鼻、帽(單顆)自動出局。
 * ② 眼白 = 最亮的那一對,而且在**臉的正面**(|z| 最大那一側)。
 *    ⇒ 耳朵雖然也是一對,但耳朵是膚色(不夠亮)而且 z≈0(在兩側)⇒ 出局。
 * ③ 瞳孔 = 暗色、比眼白**小**、和眼白**同一個 x、同一個高度**、而且更靠臉外側。
 * ④ 眉毛 = 暗色、**扁的**(寬 > 高)、在眼白**上方**。
 * ⚠ 每一項都要求「和眼白對得上」才收——認不到眼白就整個放棄,不亂猜。
 */

/* 累加到 root 為止的局部座標。★ 不用 Matrix4:本檔不 import three,
   而且只拿來做**相對比較**(誰在誰上面、誰在誰外面),共同偏移不影響判斷。 */
function localPos(obj, root) {
  let x = 0, y = 0, z = 0, o = obj;
  let guard = 0;
  while (o && o !== root && guard++ < 64) { x += o.position.x; y += o.position.y; z += o.position.z; o = o.parent; }
  return o === root ? { x, y, z } : null;   // 不在 root 底下就不算
}

/* 量一個 mesh 的長寬高:優先讀 geometry.parameters(便宜、不必算 bounding box) */
function meshSize(o) {
  const g = o.geometry;
  const p = (g && g.parameters) || {};
  if (p.radius !== undefined) {
    const r = p.radius * 2;
    return { w: r * (o.scale ? o.scale.x : 1), h: (p.height !== undefined ? p.height + r : r) * (o.scale ? o.scale.y : 1), d: r * (o.scale ? o.scale.z : 1) };
  }
  if (p.width !== undefined) {
    return { w: p.width * (o.scale ? o.scale.x : 1), h: p.height * (o.scale ? o.scale.y : 1), d: p.depth * (o.scale ? o.scale.z : 1) };
  }
  if (g && g.boundingBox) {
    const b = g.boundingBox;
    return { w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z };
  }
  return null;   // 量不到就不參加(寧可少做)
}

function luminance(o) {
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  const c = m && m.color;
  if (!c || typeof c.r !== "number") return 0.5;          // 量不到顏色 = 不表態
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/* 掃出 headGroup 底下所有「可比較」的 mesh */
function collect(head) {
  const out = [];
  const walk = (o) => {
    if (!o) return;
    if (o !== head && o.isMesh && !o.isInstancedMesh && o.position && o.geometry) {
      const p = localPos(o, head);
      const s = p && meshSize(o);
      if (p && s) out.push({ o, x: p.x, y: p.y, z: p.z, w: s.w, h: s.h, d: s.d, lum: luminance(o), big: Math.max(s.w, s.h, s.d) });
    }
    const kids = o.children || [];
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(head);
  return out;
}

/* 找出所有「左右鏡像成對」的組合 */
function mirrorPairs(items, tol) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (Math.abs(a.x + b.x) > tol) continue;              // x 要相反
      if (Math.abs(a.x) < tol) continue;                    // 落在中線的不算(鼻/嘴)
      if (Math.abs(a.y - b.y) > tol) continue;              // 同高
      if (Math.abs(a.z - b.z) > tol) continue;              // 同深
      if (Math.abs(a.big - b.big) > Math.max(a.big, b.big) * 0.34) continue;  // 大小相近
      const l = a.x <= b.x ? a : b, r = a.x <= b.x ? b : a;  // l = x 較小那一邊
      pairs.push({ l, r, x: Math.abs(l.x), y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, big: (a.big + b.big) / 2, lum: (a.lum + b.lum) / 2 });
    }
  }
  return pairs;
}

/* 主函式:回傳 { brows?, eyes?, pupils? },每一項都是 { l, r } 的 Mesh。
   認不出來的就不放進去(呼叫端照原本的「缺哪個略過哪段」處理)。 */
export function discoverFaceParts(fig) {
  const out = {};
  const head = fig && fig.headGroup;
  if (!head || !head.children) return out;

  const items = collect(head);
  if (items.length < 2) return out;

  // 頭半徑:拿最大的那個 mesh 當頭(帽子可能更大,取 max 仍是同一個量級)
  let R = 0;
  for (const it of items) if (it.big > R) R = it.big;
  R = R / 2 || 0.15;
  const tol = R * 0.16;

  const pairs = mirrorPairs(items, tol);
  if (!pairs.length) return out;

  /* ② 眼白:最亮、而且**長在臉的正面**的一對。
     ⚠⚠ 光看亮度會把**耳朵**認成眼睛:實測膚色 0xf0d3aa 的 lum = **0.84**,
       離白色 1.0 只差 0.16,而且各站膚色深淺不一(0xd9a06f 只有 0.67)
       ⇒ 亮度門檻怎麼調都會有站踩線。**位置才是可靠的判準**:
         · 耳朵在頭的兩側 ⇒ z ≈ 0、|x| ≈ 頭半徑
         · 眼睛在臉的正面 ⇒ |z| 明顯大於 0,而且比 |x| 大
       (這一條是自測「只有耳朵時不可以認成眼睛」逼出來的。) */
  let eyes = null;
  for (const p of pairs) {
    if (p.lum < 0.88) continue;                 // 白眼白(≥0.98)過得了,最淺的膚色(0.84)過不了
    if (Math.abs(p.z) < R * 0.25) continue;     // 貼在頭側面的(耳朵)出局
    if (Math.abs(p.z) < Math.abs(p.x) * 0.7) continue;  // 更靠側面而不是正面的出局
    if (!eyes || p.lum > eyes.lum + 0.02 || (Math.abs(p.lum - eyes.lum) <= 0.02 && Math.abs(p.z) > Math.abs(eyes.z))) eyes = p;
  }
  if (!eyes) return out;                     // 認不到眼白 ⇒ 整個放棄,不亂猜
  out.eyes = { l: eyes.l.o, r: eyes.r.o };
  const front = eyes.z >= 0 ? 1 : -1;        // 臉朝 +z 還是 -z

  /* ③ 瞳孔:暗、比眼白小、x 對得上、同高、而且比眼白更靠外(在眼白前面) */
  let pupils = null;
  for (const p of pairs) {
    if (p === eyes || p.lum > 0.4) continue;
    if (p.big >= eyes.big * 0.95) continue;                    // 要比眼白小
    if (Math.abs(p.x - eyes.x) > tol * 1.5) continue;          // 同一個 x
    if (Math.abs(p.y - eyes.y) > R * 0.35) continue;           // 同一個高度
    if (p.z * front < eyes.z * front - tol) continue;          // 不可以在眼白後面
    if (!pupils || p.z * front > pupils.z * front) pupils = p;  // 取最前面那一對
  }
  if (pupils) out.pupils = { l: pupils.l.o, r: pupils.r.o };

  /* ④ 眉毛:暗、扁(寬 > 高)、在眼白上方、大致在同一個臉面上 */
  let brows = null;
  for (const p of pairs) {
    if (p === eyes || p === pupils || p.lum > 0.45) continue;
    if (p.y <= eyes.y + tol * 0.5) continue;                   // 一定要在眼睛上面
    if (p.y > eyes.y + R * 1.1) continue;                      // 太高的是帽緣不是眉毛
    if (p.z * front <= 0) continue;                            // 要在臉的正面
    const flat = p.l.w > p.l.h * 1.4;                          // 扁的才是眉毛
    if (!flat) continue;
    if (!brows || p.y < brows.y) brows = p;                     // 取最靠近眼睛的一對
  }
  if (brows) out.brows = { l: brows.l.o, r: brows.r.o };

  /* ⑤ 嘴:臉中線上、眼睛**下方**的那一個(單顆,不是一對)。
     實測 soccer3d 的觀眾嘴是一顆 TorusGeometry,工廠沒回傳 ⇒ 90 位觀眾的嘴從來不會動。
     ⚠ 判準要嚴:必須在中線(|x| 很小)、在眼睛下面、在臉的正面、而且比頭小很多
        —— 寧可漏掉也不要把鼻子或下巴當成嘴去拉長。 */
  let mouth = null;
  for (const it of items) {
    if (it === eyes.l || it === eyes.r) continue;
    if (Math.abs(it.x) > tol * 0.8) continue;                  // 要在中線
    if (it.y > eyes.y - R * 0.15) continue;                    // 要在眼睛下面
    if (it.z * front < R * 0.4) continue;                      // 要在臉的正面
    if (it.big > eyes.big * 3.2) continue;                     // 太大的是頭/下巴
    if (!mouth || it.y < mouth.y) mouth = it;                  // 取最低的那一個
  }
  if (mouth) out.smile = mouth.o;

  return out;
}

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
    // 第一次見到這個人偶時量一次手臂夠不夠長,不夠就拉長(見 fitArmReach)。
    // 用 opts.fitArms === false 可以關掉(人物工廠已經自己給足長度的站)。
    if (c._fit === undefined) c._fit = opts.fitArms === false ? 1 : fitArmReach(f, opts.armMargin);
    /* 第一次見到這個人偶時,把工廠沒回傳的眉/眼/瞳**自己認出來**(見 discoverFaceParts)。
       ⚠ 只補「工廠沒給」的那幾個 —— 工廠明講的一律優先,絕不覆蓋。
       認不出來就維持 undefined,下面照原本的「缺哪個略過哪段」處理。
       要關掉:opts.discoverFace === false。 */
    if (c._face === undefined) {
      c._face = 1;
      if (opts.discoverFace !== false && (!f.brows || !f.eyes || !f.pupils || !f.smile)) {
        const found = discoverFaceParts(f);
        if (!f.eyes && found.eyes) f.eyes = found.eyes;
        if (!f.pupils && found.pupils) f.pupils = found.pupils;
        if (!f.brows && found.brows) f.brows = found.brows;
        if (!f.smile && found.smile) f.smile = found.smile;
      }
    }
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
        const b = brows[i]; if (!b || !b.position) continue;
        // ⚠ 真的 three Mesh 一定有 userData,但自動辨識可能撈到別人塞進場景的物件 ⇒ 補上就好,不炸
        if (!b.userData) b.userData = {};
        if (b.userData._y0 === undefined) b.userData._y0 = b.position.y; // 記基準,只記一次
        b.position.y = b.userData._y0 + up * 0.034;
        if (b.rotation) b.rotation.z = (i === 0 ? 1 : -1) * up * 0.30; // 外端上挑=興奮
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
