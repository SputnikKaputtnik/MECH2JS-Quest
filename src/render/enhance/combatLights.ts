/** @portOnly Optional local weapon light, layered over the original palette.
 * Read-only access to live effect pools; no simulation events/timing are changed.
 * Four segment lights in the existing material pass, without extra shadow maps.
 */
import { Matrix4, Vector3 } from 'three';
import type { MeshBlock, Projectile, SimSlot } from '../../generated/classes.gen.ts';
import type { EffectType } from '../../data/exe/tables/effects.ts';
import { blockToMatrix4, CM_TO_UNITS } from '../bridge/space.ts';

export const MAX_COMBAT_LIGHTS = 4;
export interface CombatLightUniforms {
  uCombatLightCount: { value: number };
  uCombatLightStart: { value: Float32Array };
  uCombatLightEnd: { value: Float32Array };
  uCombatLightColour: { value: Float32Array };
}
export function makeCombatLightUniforms(): CombatLightUniforms {
  return { uCombatLightCount: { value: 0 }, uCombatLightStart: { value: new Float32Array(MAX_COMBAT_LIGHTS * 4) },
    uCombatLightEnd: { value: new Float32Array(MAX_COMBAT_LIGHTS * 4) },
    uCombatLightColour: { value: new Float32Array(MAX_COMBAT_LIGHTS * 3) } };
}

export const COMBAT_LIGHT_GLSL = /* glsl */ `
uniform int uCombatLightCount;
uniform vec4 uCombatLightStart[${MAX_COMBAT_LIGHTS}]; // xyz metres, w radius
uniform vec4 uCombatLightEnd[${MAX_COMBAT_LIGHTS}];   // xyz metres, w intensity
uniform vec3 uCombatLightColour[${MAX_COMBAT_LIGHTS}];
vec3 combatLight(vec3 base, vec3 world, vec3 normal) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${MAX_COMBAT_LIGHTS}; i++) {
    if (i >= uCombatLightCount) break;
    vec3 a = uCombatLightStart[i].xyz;
    vec3 ab = uCombatLightEnd[i].xyz - a;
    float t = clamp(dot(world - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    vec3 delta = a + t * ab - world;
    float distance2 = dot(delta, delta);
    float radius = uCombatLightStart[i].w;
    float falloff = max(0.0, 1.0 - distance2 / (radius * radius));
    float facing = max(0.0, dot(normal, delta * inversesqrt(max(distance2, 0.0001))));
    light += uCombatLightColour[i] * uCombatLightEnd[i].w * falloff * falloff * facing;
  }
  // Bounded brightening preserves the original surface colour/detail and avoids
  // blowing a salvo out to white. No bloom, emissive fog or fullscreen flash.
  return base + (vec3(1.0) - base) * min(light, vec3(0.65));
}
`;

interface BeamShape { start: Vector3; end: Vector3; paletteIndex: number }
export class CombatLights {
  private readonly shapes = new WeakMap<MeshBlock, BeamShape>();
  private readonly matrix = new Matrix4();
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly scores = new Float64Array(MAX_COMBAT_LIGHTS);
  constructor(readonly uniforms: CombatLightUniforms) {}

  /** eye and uniforms use Three's metres; source pools use left-handed cm. */
  update(enabled: boolean, projectiles: readonly Projectile[], effects: readonly SimSlot[],
    types: readonly EffectType[], eye: Vector3, palette: ArrayLike<number>): void {
    this.uniforms.uCombatLightCount.value = 0;
    if (!enabled) return;
    // MW2 weapon table: large/pulse-large=0, medium/pulse-medium=1,
    // small/pulse-small=2. Missiles, ballistic rounds and debris do not glow.
    for (const p of projectiles) {
      if (!p.active || p.timeLeft <= 0 || p.id < 0 || p.id > 2 || !p.node) continue;
      const mesh = p.node.userData?.meshList;
      if (!mesh || mesh.vertexCount === 0) continue;
      let shape = this.shapes.get(mesh);
      if (!shape) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, paletteIndex = 0;
        // The original laser model's long axis is local Z. Keep its actual
        // endpoints (including the trailing beam), not a guessed muzzle ray.
        for (let i = 0; i < mesh.vertexCount; i++) {
          const v = mesh.vertices[i]!;
          minX = Math.min(minX, v.modelX); maxX = Math.max(maxX, v.modelX);
          minY = Math.min(minY, v.modelY); maxY = Math.max(maxY, v.modelY);
          minZ = Math.min(minZ, v.modelZ); maxZ = Math.max(maxZ, v.modelZ);
          const index = v.texU & 255;
          if (index !== 255 && index > paletteIndex) paletteIndex = index;
        }
        const x = (minX + maxX) * 0.5 * CM_TO_UNITS, y = (minY + maxY) * 0.5 * CM_TO_UNITS;
        shape = { start: new Vector3(x, y, -minZ * CM_TO_UNITS), end: new Vector3(x, y, -maxZ * CM_TO_UNITS), paletteIndex };
        this.shapes.set(mesh, shape);
      }
      blockToMatrix4(p.node.worldBlock, this.matrix);
      this.start.copy(shape.start).applyMatrix4(this.matrix); this.end.copy(shape.end).applyMatrix4(this.matrix);
      const at = shape.paletteIndex * 4;
      const r = (palette[at] ?? 0) / 255, g = (palette[at + 1] ?? 0) / 255, b = (palette[at + 2] ?? 0) / 255;
      // Follow the actual beam palette, including mission palettes; a fade to
      // black must not leave an unrelated coloured lamp behind.
      this.offer(eye, 18 - p.id * 4, 0.7, r, g, b);
    }
    for (const e of effects) {
      const type = types[e.typeIndex];
      if (!e.active || e.timeLeft <= 0 || !type || type.lifetime <= 0) continue;
      const laserImpact = e.typeIndex >= 0 && e.typeIndex <= 2;
      if (!type.lightsScene && !laserImpact) continue;
      const duration = Math.min(0.75, type.lifetime / 182);
      const age = Math.max(0, (type.lifetime - e.timeLeft) / 182);
      const fade = Math.max(0, 1 - age / duration);
      if (fade === 0) continue;
      this.start.set(e.x * CM_TO_UNITS, e.y * CM_TO_UNITS, -e.z * CM_TO_UNITS);
      this.end.copy(this.start);
      const radius = laserImpact ? 18 : Math.min(70, Math.max(25, (e.node?.userData?.radius ?? 0) * CM_TO_UNITS * 2));
      const cool = type.screenFadePalette === 2;
      this.offer(eye, radius, fade * fade * (laserImpact ? 0.45 : 0.9), cool ? 0.3 : 1, cool ? 0.55 : 0.38, cool ? 1 : 0.08);
    }
  }

  private offer(eye: Vector3, radius: number, intensity: number, r: number, g: number, b: number): void {
    const ax = this.end.x - this.start.x, ay = this.end.y - this.start.y, az = this.end.z - this.start.z;
    const t = Math.max(0, Math.min(1, ((eye.x - this.start.x) * ax + (eye.y - this.start.y) * ay + (eye.z - this.start.z) * az) / Math.max(0.0001, ax * ax + ay * ay + az * az)));
    const dx = this.start.x + t * ax - eye.x, dy = this.start.y + t * ay - eye.y, dz = this.start.z + t * az - eye.z;
    const score = intensity * Math.max(r, g, b) / (1 + (dx * dx + dy * dy + dz * dz) / (radius * radius));
    if (score <= 0) return;
    const u = this.uniforms, count = u.uCombatLightCount.value;
    let i = 0;
    while (i < count && this.scores[i]! >= score) i++;
    if (i === MAX_COMBAT_LIGHTS) return;
    for (let j = Math.min(count, MAX_COMBAT_LIGHTS - 1); j > i; j--) {
      this.scores[j] = this.scores[j - 1]!;
      u.uCombatLightStart.value.copyWithin(j * 4, (j - 1) * 4, j * 4);
      u.uCombatLightEnd.value.copyWithin(j * 4, (j - 1) * 4, j * 4);
      u.uCombatLightColour.value.copyWithin(j * 3, (j - 1) * 3, j * 3);
    }
    this.scores[i] = score;
    const a = u.uCombatLightStart.value, z = u.uCombatLightEnd.value, c = u.uCombatLightColour.value;
    a[i * 4] = this.start.x; a[i * 4 + 1] = this.start.y; a[i * 4 + 2] = this.start.z; a[i * 4 + 3] = radius;
    z[i * 4] = this.end.x; z[i * 4 + 1] = this.end.y; z[i * 4 + 2] = this.end.z; z[i * 4 + 3] = intensity;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    u.uCombatLightCount.value = Math.min(count + 1, MAX_COMBAT_LIGHTS);
  }
}
