import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { makeViewUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { SkyGround } from '../../src/render/passes/skyGround.ts';
import { XrSky } from '../../src/render/xr/xrSky.ts';

describe('mission render resource ownership', () => {
  it('preserves shared textures while views close, then frees current root textures only', () => {
    const root = new SceneRenderer();
    const u = root.uniforms;
    const view = new SceneRenderer(makeViewUniforms(u, true, false));
    const oldAtlas = u.uAtlas.value;
    const oldDispose = vi.spyOn(oldAtlas, 'dispose');
    // The atlas builder releases the placeholder and transfers a new texture.
    oldAtlas.dispose();
    u.uAtlas.value = new THREE.DataTexture();
    const owned = [u.uPalette, u.uLuma, u.uAtlas, u.uSlots, u.uShadowTable].map(t => vi.spyOn(t.value, 'dispose'));
    u.uShadowMap.value = new THREE.DepthTexture(1, 1);
    const borrowed = vi.spyOn(u.uShadowMap.value, 'dispose');
    view.destroy();
    root.clear();
    for (const dispose of owned) expect(dispose).not.toHaveBeenCalled();
    root.destroy();
    for (const dispose of owned) expect(dispose).toHaveBeenCalledTimes(1);
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(borrowed).not.toHaveBeenCalled();
    u.uShadowMap.value.dispose();
  });

  it('releases screen and immersive HUD/sky surfaces without releasing their borrowed palette', () => {
    const root = new SceneRenderer();
    const hud = new HudOverlay(root.uniforms);
    const sky = new SkyGround(root.uniforms);
    const xrSky = new XrSky(root.uniforms);
    const flat = hud.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    const meshes = [flat, hud.worldMesh, hud.reticleMesh, hud.markerMesh, sky.mesh, xrSky.mesh];
    const parent = new THREE.Scene();
    parent.add(...meshes);
    const disposals = meshes.flatMap(m => [vi.spyOn(m.geometry, 'dispose'), vi.spyOn(m.material, 'dispose')]);
    const palette = vi.spyOn(root.uniforms.uPalette.value, 'dispose');
    hud.dispose(); sky.dispose(); xrSky.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(palette).not.toHaveBeenCalled();
    root.destroy();
  });
});
