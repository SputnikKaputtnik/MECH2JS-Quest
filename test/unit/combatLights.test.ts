import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MeshBlock, MeshVertex, Projectile, SceneNode, SimSlot, WorldObject } from '../../src/generated/classes.gen.ts';
import { CombatLights, makeCombatLightUniforms, MAX_COMBAT_LIGHTS } from '../../src/render/enhance/combatLights.ts';
import { makeUniforms, makeViewUniforms } from '../../src/render/materials/indexedMaterial.ts';
import type { EffectType } from '../../src/data/exe/tables/effects.ts';

const type: EffectType = { lifetime: 182, lightsScene: 1, needsNode: 1, screenFadePalette: 1,
  soundId: 0, soundChance: 0, areaQuery: 0 };
function explosion(x = 0) { return Object.assign(new SimSlot(), { active: 1, timeLeft: 182, typeIndex: 3, x, y: 200, z: 300 }); }
const types: EffectType[] = []; types[3] = type;
function laser() {
  const mesh = new MeshBlock();
  mesh.vertices = [-1320, 0].map(modelZ => Object.assign(new MeshVertex(), { modelZ, texU: 100 }));
  mesh.vertexCount = 2;
  const node = new SceneNode(); node.worldMatrix[0] = node.worldMatrix[4] = node.worldMatrix[8] = 0x20000000;
  node.worldPos.set([1000, 2000, 3000]);
  node.userData = Object.assign(new WorldObject(), { meshList: mesh });
  return Object.assign(new Projectile(), { id: 0, node, active: 1, timeLeft: 50 });
}
describe('bounded combat lighting', () => {
  it('uses original beam endpoints, current pose and palette; never changes the projectile', () => {
    const u = makeCombatLightUniforms(), lights = new CombatLights(u), p = laser();
    const palette = new Uint8Array(1024); palette.set([10, 200, 30, 255], 400);
    const before = [...p.node!.worldBlock];
    lights.update(true, [p], [], [], new Vector3(), palette);
    expect(u.uCombatLightCount.value).toBe(1);
    expect([...u.uCombatLightStart.value.slice(0, 3)]).toEqual([10, 20, expect.closeTo(-16.8, 4)]);
    expect([...u.uCombatLightEnd.value.slice(0, 3)]).toEqual([10, 20, -30]);
    expect(u.uCombatLightColour.value[1]).toBeCloseTo(200 / 255);
    expect([...p.node!.worldBlock]).toEqual(before);
    p.node!.worldPos[0] = 2000;
    lights.update(true, [p], [], [], new Vector3(), palette);
    expect(u.uCombatLightStart.value[0]).toBe(20);
    p.node!.worldMatrix.set([0, 0, 0x20000000, 0, 0x20000000, 0, -0x20000000, 0, 0]);
    lights.update(true, [p], [], [], new Vector3(), palette);
    expect([...u.uCombatLightStart.value.slice(0, 3)]).toEqual([expect.closeTo(6.8, 4), 20, -30]);
    palette.fill(0);
    lights.update(true, [p], [], [], new Vector3(), palette);
    expect(u.uCombatLightCount.value).toBe(0);
  });

  it('converts explosion units, decays the flash, and clears it after expiry or disabling', () => {
    const u = makeCombatLightUniforms(), lights = new CombatLights(u), e = explosion(100);
    const run = (on = true) => lights.update(on, [], [e], types, new Vector3(), []);
    run(); expect(u.uCombatLightStart.value.slice(0, 4)).toEqual(new Float32Array([1, 2, -3, 25]));
    expect(u.uCombatLightEnd.value[3]).toBeCloseTo(0.9);
    e.timeLeft -= 68; run(); expect(u.uCombatLightEnd.value[3]).toBeCloseTo(0.9 * (1 - 68 / (182 * 0.75)) ** 2);
    const remaining = e.timeLeft; run(); expect(e.timeLeft).toBe(remaining); // paused sim: no wall-clock aging
    run(false); expect(u.uCombatLightCount.value).toBe(0);
    e.timeLeft = 1; run(); expect(u.uCombatLightCount.value).toBe(0);
    e.timeLeft = 182; e.active = 0; run(); expect(u.uCombatLightCount.value).toBe(0);
  });

  it('keeps the four most relevant sources in stable order with bounded storage', () => {
    const u = makeCombatLightUniforms(), lights = new CombatLights(u);
    const start = u.uCombatLightStart.value;
    const effects = Array.from({ length: 100 }, (_, i) => explosion((100 - i) * 100));
    lights.update(true, [], effects, types, new Vector3(), []);
    expect(u.uCombatLightCount.value).toBe(MAX_COMBAT_LIGHTS);
    expect([0, 4, 8, 12].map(i => start[i])).toEqual([1, 2, 3, 4]);
    lights.update(true, [], [], types, new Vector3(), []);
    expect(u.uCombatLightCount.value).toBe(0); expect(u.uCombatLightStart.value).toBe(start);
  });

  it('ignores missiles, ballistics, inactive beams, debris and unknown effects', () => {
    const u = makeCombatLightUniforms(), lights = new CombatLights(u);
    const palette = new Uint8Array(1024).fill(255);
    const p = laser();
    for (const id of [-1, 3, 4, 5, 7, 22]) {
      p.id = id; lights.update(true, [p], [], [], new Vector3(), palette);
      expect(u.uCombatLightCount.value).toBe(0);
    }
    p.id = 0; p.active = 0;
    const debris = explosion(); debris.typeIndex = 11;
    lights.update(true, [p], [debris], types, new Vector3(), palette);
    expect(u.uCombatLightCount.value).toBe(0);
  });

  it('never enables lights in indexed inset/map views when the main view is enabled', () => {
    const u = makeUniforms(); u.uCombatLightCount.value = 4;
    expect(makeViewUniforms(u, true, false).uCombatLightCount.value).toBe(0);
    expect(makeViewUniforms(u, true, true).uCombatLightCount.value).toBe(0);
  });
});
