import * as THREE from 'three';

// Spell & ambience particle system. One pooled THREE.Points cloud drawn with
// additive blending; projectiles are lightweight emitters that home on their
// target and burst on arrival. No textures — soft discs shaded in GLSL.

const CAPACITY = 4096;

export const SCHOOL_COLORS: Record<string, number> = {
  fire: 0xff7a2a,
  frost: 0x8ed2ff,
  arcane: 0xd98aff,
  shadow: 0x9a5df0,
  holy: 0xffe9a0,
  nature: 0x86e86a,
  physical: 0xfff2d8,
};

interface Projectile {
  pos: THREE.Vector3;
  targetId: number;
  color: THREE.Color;
  speed: number;
  ttl: number;
}

export type EntityAnchor = (id: number, heightFrac: number) => THREE.Vector3 | null;

export class Vfx {
  private points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array; // remaining
  private maxLife: Float32Array;
  private grav: Float32Array;
  private alphaAttr: Float32Array;
  private head = 0;
  private projectiles: Projectile[] = [];
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, private anchor: EntityAnchor) {
    this.pos = new Float32Array(CAPACITY * 3);
    this.vel = new Float32Array(CAPACITY * 3);
    this.col = new Float32Array(CAPACITY * 3);
    this.size = new Float32Array(CAPACITY);
    this.life = new Float32Array(CAPACITY);
    this.maxLife = new Float32Array(CAPACITY);
    this.grav = new Float32Array(CAPACITY);
    this.alphaAttr = new Float32Array(CAPACITY);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1));
    // huge static bounding sphere: particles fly everywhere, skip recompute
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(450, 0, 0), 2400);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d) * 2.0;
          float fall = smoothstep(1.0, 0.15, r);
          if (fall * vAlpha < 0.012) discard;
          gl_FragColor = vec4(vColor, fall * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  setViewportScale(heightPx: number, fovDeg: number): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.Color | number, size: number, lifetime: number, gravity = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % CAPACITY;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.tmpColor.set(color as THREE.ColorRepresentation);
    this.col[i * 3] = this.tmpColor.r; this.col[i * 3 + 1] = this.tmpColor.g; this.col[i * 3 + 2] = this.tmpColor.b;
    this.size[i] = size;
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
    this.grav[i] = gravity;
    this.alphaAttr[i] = 1;
  }

  // ---------------------------------------------------------------------
  // High-level effects
  // ---------------------------------------------------------------------

  projectile(sourceId: number, targetId: number, school: string): void {
    const from = this.anchor(sourceId, 0.62);
    if (!from) return;
    const color = new THREE.Color(SCHOOL_COLORS[school] ?? 0xffffff);
    this.projectiles.push({ pos: from.clone(), targetId, color, speed: 26, ttl: 3 });
  }

  burst(at: THREE.Vector3, school: string, count = 18, power = 1): void {
    const c = SCHOOL_COLORS[school] ?? 0xffffff;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = (2 + Math.random() * 4.5) * power;
      this.spawn(
        at.x, at.y, at.z,
        Math.sin(a) * sp, up * sp * 0.8, Math.cos(a) * sp,
        c, 0.34 + Math.random() * 0.3 * power, 0.45 + Math.random() * 0.35, 7,
      );
    }
  }

  tick(targetId: number, school: string): void {
    const at = this.anchor(targetId, 0.55);
    if (at) this.burst(at, school, 7, 0.6);
  }

  nova(centerId: number, school: string): void {
    const at = this.anchor(centerId, 0.12);
    if (!at) return;
    const c = SCHOOL_COLORS[school] ?? 0xffffff;
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const sp = 11 + Math.random() * 3;
      this.spawn(at.x, at.y + 0.25, at.z, Math.sin(a) * sp, 1.2, Math.cos(a) * sp, c, 0.5, 0.55, 6);
    }
  }

  healGlow(targetId: number): void {
    const at = this.anchor(targetId, 0.1);
    if (!at) return;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.7;
      this.spawn(
        at.x + Math.sin(a) * r, at.y + Math.random() * 0.4, at.z + Math.cos(a) * r,
        Math.sin(a) * 0.25, 1.6 + Math.random() * 1.4, Math.cos(a) * 0.25,
        i % 3 === 0 ? 0xbaf7a0 : 0xffe9a0, 0.3 + Math.random() * 0.25, 0.9 + Math.random() * 0.5, -1.2,
      );
    }
  }

  buffSwirl(targetId: number, color = 0xffe9a0): void {
    const at = this.anchor(targetId, 0.2);
    if (!at) return;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawn(
        at.x + Math.sin(a) * 0.85, at.y + 0.2, at.z + Math.cos(a) * 0.85,
        -Math.cos(a) * 1.6, 2.1, Math.sin(a) * 1.6,
        color, 0.3, 0.8, -1.5,
      );
    }
  }

  meleeSpark(targetId: number, crit: boolean): void {
    const at = this.anchor(targetId, 0.55);
    if (!at) return;
    this.burst(at, 'physical', crit ? 14 : 6, crit ? 1.1 : 0.55);
  }

  levelUpPillar(targetId: number): void {
    const at = this.anchor(targetId, 0);
    if (!at) return;
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.9;
      this.spawn(
        at.x + Math.sin(a) * r, at.y + Math.random() * 0.3, at.z + Math.cos(a) * r,
        0, 4.5 + Math.random() * 3.5, 0,
        i % 4 === 0 ? 0xfff8e0 : 0xffd14d, 0.42, 1.1 + Math.random() * 0.4, -1,
      );
    }
  }

  // continuous emitters (called per frame)
  castSparkle(entityId: number, school: string, dt: number): void {
    if (Math.random() > dt * 30) return;
    const at = this.anchor(entityId, 0.66);
    if (!at) return;
    const c = SCHOOL_COLORS[school] ?? 0xffffff;
    const a = Math.random() * Math.PI * 2;
    this.spawn(
      at.x + Math.sin(a) * 0.5, at.y, at.z + Math.cos(a) * 0.5,
      0, 0.9 + Math.random(), 0,
      c, 0.26, 0.5, -0.5,
    );
  }

  swimRipple(at: THREE.Vector3, dt: number): void {
    if (Math.random() > dt * 9) return;
    const a = Math.random() * Math.PI * 2;
    this.spawn(
      at.x + Math.sin(a) * 0.5, at.y + 0.55, at.z + Math.cos(a) * 0.5,
      Math.sin(a) * 1.2, 1.1, Math.cos(a) * 1.2,
      0xcfe9ff, 0.3, 0.55, 5,
    );
  }

  campfireEmber(at: THREE.Vector3, dt: number): void {
    if (Math.random() > dt * 6) return;
    this.spawn(
      at.x + (Math.random() - 0.5) * 0.5, at.y + 0.5, at.z + (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5,
      Math.random() < 0.4 ? 0xffd14d : 0xff7a2a, 0.2, 1.0 + Math.random() * 0.6, -0.4,
    );
  }

  // ---------------------------------------------------------------------

  update(dt: number): void {
    // projectiles home on their (moving) target
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.ttl -= dt;
      const target = this.anchor(pr.targetId, 0.5);
      if (!target || pr.ttl <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const dir = target.clone().sub(pr.pos);
      const dist = dir.length();
      const step = pr.speed * dt;
      if (dist <= Math.max(0.7, step)) {
        // impact
        for (let k = 0; k < 16; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2.5 + Math.random() * 4;
          this.spawn(target.x, target.y, target.z, Math.sin(a) * sp, Math.random() * 3, Math.cos(a) * sp, pr.color, 0.36, 0.4, 7);
        }
        this.projectiles.splice(i, 1);
        continue;
      }
      dir.multiplyScalar(step / dist);
      pr.pos.add(dir);
      // bright core + sparkling trail
      this.spawn(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0, 0, pr.color, 0.85, 0.09);
      this.spawn(
        pr.pos.x + (Math.random() - 0.5) * 0.25, pr.pos.y + (Math.random() - 0.5) * 0.25, pr.pos.z + (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8,
        pr.color, 0.3, 0.45, 1.5,
      );
    }

    // advance the pool
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alphaAttr[i] = f < 0.25 ? f * 4 : 1;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}
