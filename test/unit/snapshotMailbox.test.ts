import { expect, it } from 'vitest';
import { SnapshotConsumer, SnapshotProducer, type Snapshot, type SnapshotRelease } from '../../src/engine/snapshotMailbox.ts';

function pair() {
  const publications: Snapshot<{ tick: number }>[] = [];
  const releases: SnapshotRelease[] = [];
  const producer = new SnapshotProducer<{ tick: number }>('mission-1', 32, (m, transfer) => {
    publications.push(structuredClone(m, { transfer }));
  });
  const consumer = new SnapshotConsumer<{ tick: number }>('mission-1', (m, transfer) => {
    releases.push(structuredClone(m, { transfer }));
  });
  const publish = (tick: number) => producer.publish({ tick }, buffer => new Uint8Array(buffer).fill(tick));
  const deliver = () => { while (publications.length) consumer.receive(publications.shift()!); };
  const recycle = () => { while (releases.length) producer.release(releases.shift()!); };
  return { producer, consumer, publications, releases, publish, deliver, recycle };
}

it('transfers an independent snapshot and detaches the producer view', () => {
  const p = pair();
  const original = new Uint8Array(32).fill(7);
  const meta = { tick: 7 };
  let owned: Uint8Array | undefined;
  p.producer.publish(meta, b => { owned = new Uint8Array(b); owned.set(original); });
  expect(owned!.byteLength).toBe(0);
  original.fill(9); meta.tick = 9;
  p.deliver();
  const current = p.consumer.acquire()!;
  expect(current.meta.tick).toBe(7);
  expect([...new Uint8Array(current.buffer)]).toEqual(Array(32).fill(7));
});

it('bounds in-flight storage at three slots and skips work before writing', () => {
  const p = pair();
  expect([p.publish(1), p.publish(2), p.publish(3)]).toEqual([true, true, true]);
  expect(p.producer.publish({ tick: 4 }, () => { throw Error('must not extract while full'); })).toBe(false);
  expect(p.publications).toHaveLength(3);
  p.deliver();
  expect(p.consumer.acquire()!.meta.tick).toBe(3);
  expect(p.consumer.stats.superseded).toBe(2);
  p.recycle();
  expect(p.publish(5)).toBe(true);
});

it('holds a displayed snapshot intact while newer publications replace one another', () => {
  const p = pair();
  p.publish(1); p.deliver();
  const displayed = p.consumer.acquire()!;
  for (let i = 2; i <= 100; i++) {
    expect(p.publish(i)).toBe(true);
    p.deliver(); p.recycle();
    expect(new Uint8Array(displayed.buffer)[0]).toBe(1);
  }
  expect(p.consumer.acquire()!.meta.tick).toBe(100);
  expect(displayed.buffer.byteLength).toBe(0);
  expect(p.consumer.acquire()!.meta.tick).toBe(100);
  p.recycle();
  p.consumer.close(); p.recycle();
  expect(p.consumer.acquire()).toBeNull();
  expect([p.publish(101), p.publish(102), p.publish(103)]).toEqual([true, true, true]);
});

it('recycles pending, displayed and late-arriving buffers on disposal', () => {
  const p = pair();
  p.publish(1); p.deliver(); p.consumer.acquire();
  p.publish(2); p.deliver(); p.publish(3);
  p.consumer.close(); p.consumer.close(); p.deliver(); p.recycle();
  expect(p.consumer.acquire()).toBeNull();
  expect([p.publish(4), p.publish(5), p.publish(6)]).toEqual([true, true, true]);
  p.producer.close();
  expect(p.publish(7)).toBe(false);
});

it('rejects duplicate releases and does not accept a previous mission into a new pool', () => {
  const p = pair();
  p.publish(1); p.deliver(); p.consumer.acquire(); p.consumer.close();
  const release = p.releases.shift()!;
  p.producer.release(release);
  expect(() => p.producer.release(release)).toThrow('Invalid snapshot release');
  expect(() => p.producer.release({ ...release, epoch: 'old-mission' })).not.toThrow();
  p.consumer.receive({ kind: 'snapshot', epoch: 'old-mission', sequence: 1, slot: 0, buffer: new ArrayBuffer(32), meta: { tick: 99 } });
  expect(p.consumer.acquire()).toBeNull();
});

it('keeps a slot available after extraction or structured cloning fails', () => {
  const p = pair();
  expect(() => p.producer.publish({ tick: 0 }, () => { throw Error('extraction failed'); })).toThrow();
  expect([p.publish(1), p.publish(2), p.publish(3)]).toEqual([true, true, true]);
  const producer = new SnapshotProducer<unknown>('test', 32, (m, transfer) => structuredClone(m, { transfer }));
  expect(() => producer.publish(() => {}, () => {})).toThrow();
  expect(producer.publish(null, b => expect(b.byteLength).toBe(32))).toBe(true);
});
