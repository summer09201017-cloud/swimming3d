// ══════════════════════════════════════════════════════════════════════
// water.js —— 水地基模組(C3「Water 浮力/水中對抗」核心,可整檔搬走)
// 只依賴 three,零遊戲耦合。之後「約拿落海」聖經皮直接複製本檔即可收割:
//   1. waterHeightAt(x,z,t)      波高場(所有漂浮物共用同一片浪,畫面=判定)
//   2. createWaterSurface(...)   水面渲染(CPU 頂點波+水色,借 sailing3d 色票)
//   3. applyBuoyancy(obj,...)    浮力:上下漂浮 bobbing+隨浪面傾斜(身體沉一半交給 sink)
//   4. SWIM + applySwimMotion    游泳手感:比陸上慢+慣性大(加速慢、滑行久)
//   5. SplashSystem              水花粒子+漣漪環(出手/入水/推擠共用)
// ══════════════════════════════════════════════════════════════════════
import * as THREE from "three";

// ── 量值可調(鐵則):水的手感數字全部集中這裡 ──
export const WATER = {
  // 波浪(三組正弦疊加;振幅小=室內池,約拿落海可調大成風浪)
  waves: [
    { ax: 0.055, kx: 0.55, kz: 0.35, speed: 1.15 },
    { ax: 0.04,  kx: -0.3, kz: 0.62, speed: 1.6 },
    { ax: 0.025, kx: 0.9,  kz: -0.7, speed: 2.3 },
  ],
  // 水色(借 sailing3d 色票:外海 0x1f5e96 / 賽場 0x2e77b8,室內池微亮)
  colorDeep: 0x1f5e96,
  colorPool: 0x2f7fc2,
  opacity: 0.86, // 半透明:看得到水下半身=「身體沉一半」的視覺證據
};

export const SWIM = {
  maxSpeed: 2.7,      // 游泳巡航(陸上跑 4.4 → 水裡明顯慢)
  sprintMul: 1.4,     // 打水衝刺
  accel: 2.1,         // 加速度低=起步慢(慣性大)
  drag: 0.55,         // 阻力低=放開還會滑行一段
  bobAmp: 0.05,       // 個人踩水上下浮動振幅
  bobFreq: 2.1,
  sink: 0.62,         // 身體下沉量:模型原點(腳底)往下沉,讓水線停在胸口=只見上半身
};

// 波高場:水面渲染、人、球全用同一個函數=畫面與判定永遠一致(判定=畫面鐵則)
export function waterHeightAt(x, z, t) {
  let h = 0;
  for (const w of WATER.waves) {
    h += w.ax * Math.sin(x * w.kx + z * w.kz + t * w.speed);
  }
  return h;
}

// 浪面斜率(數值微分)→ 給漂浮物一點隨浪傾斜,便宜又有效
export function waterSlopeAt(x, z, t) {
  const e = 0.35;
  return {
    dx: (waterHeightAt(x + e, z, t) - waterHeightAt(x - e, z, t)) / (2 * e),
    dz: (waterHeightAt(x, z + e, t) - waterHeightAt(x, z - e, t)) / (2 * e),
  };
}

// ── 水面渲染:CPU 頂點波(段數適中,手機也順)──
export function createWaterSurface({ width = 34, length = 24, segX = 56, segZ = 40, color = WATER.colorPool } = {}) {
  const geo = new THREE.PlaneGeometry(width, length, segX, segZ);
  geo.rotateX(-Math.PI / 2); // y-up,直接用世界 x/z 餵波高場
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.08,
    transparent: true,
    opacity: WATER.opacity,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const pos = geo.attributes.position;
  const baseX = new Float32Array(pos.count);
  const baseZ = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    baseX[i] = pos.getX(i);
    baseZ[i] = pos.getZ(i);
  }
  return {
    mesh,
    update(t) {
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, waterHeightAt(baseX[i] + mesh.position.x, baseZ[i] + mesh.position.z, t));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

// ── 浮力:把任何 Object3D 黏在浪上(bobbing+沉一半+隨浪傾斜) ──
// phase=個人相位(每人不同才不會全場同步點頭);sink>0=身體下沉(游泳者),=0=貼浪(球/浮標)
export function applyBuoyancy(obj, x, z, t, { phase = 0, sink = 0, bobAmp = SWIM.bobAmp, tiltMul = 0.6 } = {}) {
  const h = waterHeightAt(x, z, t);
  const bob = Math.sin(t * SWIM.bobFreq + phase) * bobAmp;
  obj.position.y = h - sink + bob;
  const s = waterSlopeAt(x, z, t);
  obj.rotation.x = s.dz * tiltMul;
  obj.rotation.z = -s.dx * tiltMul;
  return h;
}

// ── 游泳手感:慣性大的速度趨近(取代陸上「按=立即滿速」) ──
// desired=想要的速度向量(可為 0 向量);回傳實際 speed 供動畫用
export function applySwimMotion(velocity, desired, dt) {
  const k = 1 - Math.exp(-dt * SWIM.accel);       // 加速慢
  velocity.x += (desired.x - velocity.x) * k;
  velocity.z += (desired.z - velocity.z) * k;
  const dragK = Math.max(0, 1 - SWIM.drag * dt);  // 沒輸入也慢慢滑
  if (desired.lengthSq() < 0.001) {
    velocity.x *= dragK;
    velocity.z *= dragK;
  }
  return Math.hypot(velocity.x, velocity.z);
}

// ── 水花系統:噴濺粒子(白點拋物線)+漣漪環(貼水面擴散淡出) ──
export class SplashSystem {
  constructor(scene, { maxParticles = 260, maxRings = 24 } = {}) {
    this.scene = scene;
    this.time = 0;
    // 粒子:InstancedMesh 一次畫完
    this.pool = [];
    this.particles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9 }),
      maxParticles,
    );
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    scene.add(this.particles);
    this.live = [];
    this.maxParticles = maxParticles;
    this._dummy = new THREE.Object3D();
    // 漣漪環
    this.rings = [];
    for (let i = 0; i < maxRings; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.44, 24),
        new THREE.MeshBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, t: 1, dur: 1 });
    }
    this._hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxParticles; i++) this.particles.setMatrixAt(i, this._hide);
    this.particles.instanceMatrix.needsUpdate = true;
  }

  // strength 0~1:小=游泳划水花、中=傳球入水、大=射門出手/慶祝
  spawn(x, z, strength = 0.5, t = this.time) {
    const n = Math.round(6 + strength * 22);
    const h = waterHeightAt(x, z, t);
    for (let i = 0; i < n; i++) {
      if (this.live.length >= this.maxParticles) this.live.shift();
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.25;
      this.live.push({
        x: x + Math.cos(a) * r,
        y: h + 0.05,
        z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (0.5 + Math.random() * 1.6) * (0.4 + strength),
        vy: 1.2 + Math.random() * 2.4 * (0.4 + strength),
        vz: Math.sin(a) * (0.5 + Math.random() * 1.6) * (0.4 + strength),
        life: 0.55 + Math.random() * 0.35,
        age: 0,
        scale: 0.7 + Math.random() * 0.9 + strength * 0.6,
      });
    }
    // 漣漪:挑一個閒置環
    const slot = this.rings.find((r) => r.t >= r.dur);
    if (slot) {
      slot.t = 0;
      slot.dur = 0.8 + strength * 0.5;
      slot.strength = strength;
      slot.mesh.position.set(x, h + 0.03, z);
      slot.mesh.visible = true;
    }
  }

  update(dt, t) {
    this.time = t;
    const d = this._dummy;
    let idx = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.live.splice(i, 1);
        continue;
      }
      p.vy -= 7.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = 1 - p.age / p.life;
      d.position.set(p.x, Math.max(p.y, waterHeightAt(p.x, p.z, t) - 0.05), p.z);
      d.scale.setScalar(p.scale * (0.5 + k * 0.5));
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.particles.setMatrixAt(idx++, d.matrix);
    }
    for (let i = idx; i < this.maxParticles; i++) this.particles.setMatrixAt(i, this._hide);
    this.particles.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (r.t >= r.dur) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = 1 + k * (2.2 + (r.strength || 0.5) * 3.2);
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = 0.55 * (1 - k);
    }
  }
}

// ── 池邊水道繩(紅黃浮球串,借 sailing3d 浮筒界線做法) ──
export function createLaneRope(scene, { from, to, spacing = 0.55 } = {}) {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(2, Math.round(len / spacing));
  const geo = new THREE.SphereGeometry(0.09, 8, 6);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), n);
  const dummy = new THREE.Object3D();
  const colA = new THREE.Color(0xff5340);
  const colB = new THREE.Color(0xffd23f);
  const floats = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const x = from.x + (to.x - from.x) * k;
    const z = from.z + (to.z - from.z) * k;
    floats.push({ x, z, i });
    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, i % 6 < 3 ? colA : colB);
  }
  inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  return {
    mesh: inst,
    update(t) {
      for (const f of floats) {
        dummy.position.set(f.x, waterHeightAt(f.x, f.z, t) + 0.02, f.z);
        dummy.updateMatrix();
        inst.setMatrixAt(f.i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}
