/** Local desktop WebGL checks. No XR/device access, no player saves. */
import * as THREE from 'three';
import { makeIndexedMaterial, makeUniforms, makeViewUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { CombatLights } from '../../src/render/enhance/combatLights.ts';
import { WorldBatch } from '../../src/render/WorldBatch.ts';
import { SimSlot } from '../../src/generated/classes.gen.ts';
import type { EffectType } from '../../src/data/exe/tables/effects.ts';
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { cameraFromViewer, viewerFromCamera } from '../../src/render/bridge/cameraViewer.ts';
import { fromThree } from '../../src/render/bridge/space.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';
import { Viewer } from '../../src/generated/classes.gen.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { mainLoopFrame } from '../../src/mission/mainLoop.ts';
import { ailTimerService } from '../../src/engine/miles/ail.ts';
import { simTables } from '../../src/sim/effects/simTables.ts';
import { effectSpawnAt, effectTypes } from '../../src/sim/effects/effects.ts';
import { sceneNodeSetOrigin, sceneNodeWalk, sceneSubtreeMoveToWorldList } from '../../src/engine/scene/sceneGraph.ts';
import { GroundField } from '../../src/render/enhance/groundField.ts';
import { groundShades } from '../../src/render/enhance/paletteRuns.ts';
import { lighting } from '../../src/sim/world/environment.ts';

/** A frozen real mission plus one placed original laser/explosion. This is a
 * visual integration fixture, not a gameplay/performance/Quest comparison. */
export async function runCombatMissionImages() {
  const data = await loadGameData(new FetchSource()); setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const game = new Game(data);
  if (!game.loadMission('AMY_SCN1', { pilot: { name: 'LIGHT TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] })) throw Error(game.loadError ?? 'Mission failed');
  game.setMode('edit'); game.audio.pause();
  const sr = new SceneRenderer(), ground = new GroundField(sr.uniforms), lights = new CombatLights(sr.uniforms);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(800, 600); renderer.autoClear = false; renderer.setClearColor(0x080c16);
  const camera = new THREE.PerspectiveCamera(), v = new Viewer();
  try {
    game.bindTextures(sr);
    for (let f = 0; f < 40; f++) { for (let t = 0; t < 9; t++) ailTimerService(); mainLoopFrame(); }
    cameraFromViewer(viewer(), camera, 4 / 3);
    const ahead = camera.getWorldDirection(new THREE.Vector3()); ahead.y = 0; ahead.normalize();
    camera.position.addScaledVector(ahead, 100); // outside the player's opaque chassis
    const point = camera.position.clone().addScaledVector(ahead, 35); point.y = 3;
    camera.position.y = 24; camera.lookAt(point); camera.updateMatrix(); camera.updateMatrixWorld(true);
    const [x, y, z] = fromThree(point.x, point.y, point.z);
    effectSpawnAt(3, x, y, z, x, y, z);
    const beam = simTables.projectiles.find(p => p.id === 0 && p.node)!;
    if (!beam) throw Error('Mission has no laser model');
    beam.active = 1; beam.timeLeft = 182;
    sceneNodeSetOrigin(beam.node!, x - 700, y + 250, z);
    sceneSubtreeMoveToWorldList(beam.node!); sceneNodeWalk(beam.node!);
    sr.setPalette(game.paletteRgb()!); const luma = game.lumaRows(); if (luma) sr.setLuma(luma);
    game.updateTextures(sr); sr.setViewport(800, 600);
    sr.sync(viewerFromCamera(camera, viewer(), v));
    ground.updateGrid(camera.position, groundShades(game.paletteRgb()!, lighting.groundColour), true);
    sr.backdropScene.add(ground.grid);
    const palette = sr.uniforms.uPalette.value.image.data as Uint8Array;
    const draw = (on: boolean) => {
      lights.update(on, simTables.projectiles, simTables.simSlots, effectTypes(), camera.position, palette);
      renderer.clear(); renderer.render(sr.backdropScene, camera); renderer.clearDepth(); sr.renderWorld(renderer, camera);
      const pixels = new Uint8Array(800 * 600 * 4);
      renderer.getContext().readPixels(0, 0, 800, 600, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      return { pixels, image: renderer.domElement.toDataURL('image/png') };
    };
    const off = draw(false), on = draw(true), count = sr.uniforms.uCombatLightCount.value;
    const colours = [...sr.uniforms.uCombatLightColour.value.slice(0, count * 3)];
    const restored = draw(false);
    const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, x, i) => n + Number(x !== b[i]), 0);
    const changed = diff(off.pixels, on.pixels), restoreDifferent = diff(off.pixels, restored.pixels);
    return { valid: count >= 2 && changed >= 1000 && restoreDifferent === 0,
      camera: camera.position.toArray(), point: point.toArray(), count, colours, changedBytes: changed, restoredDifferentBytes: restoreDifferent,
      imageOn: on.image, imageOff: off.image };
  } finally { ground.dispose(); sr.destroy(); renderer.dispose(); game.audio.pause(); }
}

export function runCombatLightImages(baselineFragment: string) {
  const u = makeUniforms(), lights = new CombatLights(u), scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(512, 384); renderer.setClearColor(0x090e18);
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 200);
  const material = makeIndexedMaterial(u), baseline = makeIndexedMaterial(u);
  baseline.fragmentShader = baselineFragment;
  const palette = u.uPalette.value.image.data as Uint8Array; palette.set([65, 80, 90, 255], 100 * 4); u.uPalette.value.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(70, 30).toNonIndexed();
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('aDraw', new THREE.Float32BufferAttribute(new Float32Array(n).fill(100), 1));
  geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  geometry.setAttribute('aSprite', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(-1), 4));
  geometry.setAttribute('aSpriteR', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const mesh = new THREE.Mesh(geometry, material), group = new THREE.Group();
  group.position.z = -35; group.updateMatrix(); group.add(mesh); scene.add(group);
  const effect = Object.assign(new SimSlot(), { active: 1, timeLeft: 182, typeIndex: 3, z: 2800 });
  const types: EffectType[] = []; types[3] = { lifetime: 182, screenFadePalette: 1, lightsScene: 1, needsNode: 1, areaQuery: 0, soundId: 0, soundChance: 0 };
  const target = new THREE.WebGLRenderTarget(512, 384), batch = new WorldBatch();
  function draw(batched = false) {
    renderer.setRenderTarget(target); renderer.clear();
    if (batched) batch.render(scene, [mesh], () => renderer.render(scene, camera));
    else renderer.render(scene, camera);
    const pixels = new Uint8Array(512 * 384 * 4); renderer.readRenderTargetPixels(target, 0, 0, 512, 384, pixels);
    return pixels;
  }
  const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((sum, x, i) => sum + Number(x !== b[i]), 0);
  function check(value: boolean, message: string) { if (!value) throw Error(message); }
  try {
    mesh.material = baseline; const original = draw(); mesh.material = material;
    const off = draw(); check(diff(original, off) === 0, 'Disabled pixels differ from old shader');
    lights.update(true, [], [effect], types, camera.position, palette);
    const on = draw(), onBatch = draw(true);
    check(diff(on, onBatch) === 0, 'Batched lighting differs from unbatched lighting');
    const changed = diff(off, on); check(changed > 10000, 'Light did not illuminate the surface');
    const centre = (192 * 512 + 256) * 4;
    check(on[centre]! > off[centre]!, 'Surface centre did not brighten');
    // Light behind the plane must not illuminate its visible face.
    effect.z = 4200; lights.update(true, [], [effect], types, camera.position, palette);
    check(diff(off, draw()) === 0, 'Light leaks to the opposite face');
    effect.z = 2800; effect.timeLeft = 1; lights.update(true, [], [effect], types, camera.position, palette);
    check(diff(off, draw()) === 0, 'Expired flash remains visible');
    effect.timeLeft = 182; lights.update(true, [], [effect], types, camera.position, palette);
    const inset = makeIndexedMaterial(makeViewUniforms(u, true, false));
    mesh.material = inset; const indexedOn = draw(); u.uCombatLightCount.value = 0;
    check(diff(indexedOn, draw()) === 0, 'Inset palette output changed');
    mesh.material = material; inset.dispose();
    for (const x of [-0.032, 0.032]) {
      camera.position.x = x; u.uCombatLightCount.value = 0;
      mesh.material = baseline; const eyeReference = draw(); mesh.material = material;
      check(diff(eyeReference, draw()) === 0, 'Disabled eye pixels changed');
      lights.update(true, [], [effect], types, camera.position, palette);
      const litEye = draw();
      check(diff(litEye, draw(true)) === 0, 'Batched eye lighting changed');
      check(diff(litEye, eyeReference) > 10000, 'Eye light missing');
    }
    camera.position.x = 0;
    lights.update(true, [], [effect], types, camera.position, palette);
    renderer.setRenderTarget(null); renderer.render(scene, camera);
    const imageOn = renderer.domElement.toDataURL('image/png');
    u.uCombatLightCount.value = 0; renderer.render(scene, camera);
    const imageOff = renderer.domElement.toDataURL('image/png');
    return { simulatedEyesChecked: 2, disabledDifferentBytes: diff(original, off), batchedDifferentBytes: diff(on, onBatch),
      litDifferentBytes: changed, centreBefore: [...off.slice(centre, centre + 4)], centreAfter: [...on.slice(centre, centre + 4)],
      imageOn, imageOff };
  } finally {
    batch.dispose(); geometry.dispose(); material.dispose(); baseline.dispose(); target.dispose(); renderer.dispose();
    for (const { value } of Object.values(u)) if (value instanceof THREE.Texture) value.dispose();
  }
}
