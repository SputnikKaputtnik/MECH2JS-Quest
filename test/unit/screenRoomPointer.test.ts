import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ScreenRoom, PANEL_DISTANCE, PANEL_WIDTH, PANEL_DROP, type ScreenSource } from '../../src/render/xr/screenRoom.ts';

describe('curved VR menu ray pointer', () => {
  it('maps center and curved off-center hits into the original 640x480 menu', () => {
    const room = new ScreenRoom();
    room.show({ width: 640, height: 480 } as ScreenSource);
    const origin = new Vector3(0, -PANEL_DROP, 0);
    const center = room.pointAt(origin, new Vector3(0, 0, -1))!;
    expect(center.x).toBeCloseTo(320, 3);
    expect(center.y).toBeCloseTo(240, 3);
    for (const [u, v] of [[0.25, 0.75], [0.75, 0.25]]) {
      const a = (u! - 0.5) * PANEL_WIDTH / PANEL_DISTANCE;
      const target = new Vector3(PANEL_DISTANCE * Math.sin(a), (v! - 0.5) * PANEL_WIDTH * 0.75 - PANEL_DROP, -PANEL_DISTANCE * Math.cos(a));
      const hit = room.pointAt(origin, target.sub(origin).normalize())!;
      expect(hit.x).toBeCloseTo(u! * 640, 3);
      expect(hit.y).toBeCloseTo((1 - v!) * 480, 3);
    }
    expect(room.pointAt(origin, new Vector3(0, 0, 1))).toBeNull();
    room.show(null);
    expect(room.pointAt(origin, new Vector3(0, 0, -1))).toBeNull();
    room.dispose();
  });
});
