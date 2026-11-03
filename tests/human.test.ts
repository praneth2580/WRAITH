import { describe, expect, it } from 'vitest';
import { resolveHuman, resolveNetwork } from '../src/config.js';
import { humanPresets } from '../src/human/behavior.js';
import { neighbourKey } from '../src/human/keyboard.js';
import { humanPath, movementDuration, overshootPoint, pointInBox } from '../src/human/mouse.js';
import { createRng } from '../src/human/random.js';

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('keeps inRange and int within bounds, reaching both ends of int', () => {
    const rng = createRng(1);
    const ints = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.inRange([50, 150]);
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThanOrEqual(150);
      ints.add(rng.int(1, 3));
    }
    expect([...ints].sort()).toEqual([1, 2, 3]);
  });

  it('honours chance(0) and chance(1)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe('resolveHuman', () => {
  it('defaults to natural, maps false to off, and accepts preset names', () => {
    expect(resolveHuman(undefined)).toEqual(humanPresets.natural);
    expect(resolveHuman(true)).toEqual(humanPresets.natural);
    expect(resolveHuman(false).enabled).toBe(false);
    expect(resolveHuman('careful')).toEqual(humanPresets.careful);
  });

  it('merges overrides into a preset, replacing ranges whole', () => {
    const b = resolveHuman({ preset: 'fast', actionDelay: [1, 2], typing: { typoChance: 0.1 } });
    expect(b.actionDelay).toEqual([1, 2]);
    expect(b.typing.typoChance).toBe(0.1);
    expect(b.typing.keyDelay).toEqual(humanPresets.fast.typing.keyDelay);
    expect(b.mouse).toEqual(humanPresets.fast.mouse);
  });

  it('never mutates the shared presets', () => {
    const b = resolveHuman('natural');
    b.typing.typoChance = 0.9;
    expect(humanPresets.natural.typing.typoChance).toBe(0.02);
  });

  it('rejects invalid settings', () => {
    expect(() => resolveHuman({ typing: { typoChance: 2 } })).toThrow(/typoChance/);
    expect(() => resolveHuman({ actionDelay: [500, 100] })).toThrow(/actionDelay/);
    expect(() => resolveHuman({ mouse: { speed: 0 } })).toThrow(/speed/);
    expect(() => resolveHuman('sloppy' as never)).toThrow(/Unknown human preset/);
  });
});

describe('resolveNetwork', () => {
  it('fills in defaults and allows turning the rate limit off', () => {
    expect(resolveNetwork()).toMatchObject({
      timeout: 30_000,
      retries: 2,
      rateLimit: { concurrency: 2, maxRequests: 4, intervalMs: 1000 },
      respectRobotsTxt: false,
    });
    expect(resolveNetwork({ rateLimit: { maxRequests: 1 } }).rateLimit).toEqual({
      concurrency: 2,
      maxRequests: 1,
      intervalMs: 1000,
    });
    expect(resolveNetwork({ rateLimit: false }).rateLimit).toBe(false);
  });

  it('rejects invalid settings', () => {
    expect(() => resolveNetwork({ retries: -1 })).toThrow(/retries/);
    expect(() => resolveNetwork({ rateLimit: { concurrency: 0 } })).toThrow(/concurrency/);
  });
});

describe('mouse paths', () => {
  const options = { jitter: 2, targetWidth: 40, speed: 1 };

  it('ends exactly on the target', () => {
    const rng = createRng(11);
    for (let i = 0; i < 50; i++) {
      const to = { x: rng.float(0, 1200), y: rng.float(0, 800) };
      const path = humanPath({ x: rng.float(0, 1200), y: rng.float(0, 800) }, to, rng, options);
      expect(path.at(-1)).toMatchObject(to);
    }
  });

  it('uses more steps for longer moves and curves away from the straight line', () => {
    const rng = createRng(5);
    const short = humanPath({ x: 0, y: 0 }, { x: 30, y: 0 }, rng, options);
    const long = humanPath({ x: 0, y: 0 }, { x: 1000, y: 0 }, rng, options);
    expect(long.length).toBeGreaterThan(short.length);
    expect(Math.max(...long.map((p) => Math.abs(p.y)))).toBeGreaterThan(1);
  });

  it('follows Fitts’s law', () => {
    expect(movementDuration(800, 40, 1)).toBeGreaterThan(movementDuration(100, 40, 1));
    expect(movementDuration(400, 10, 1)).toBeGreaterThan(movementDuration(400, 200, 1));
    expect(movementDuration(400, 40, 2)).toBeLessThan(movementDuration(400, 40, 1));
  });

  it('aims inside the box, away from the edges', () => {
    const rng = createRng(9);
    const box = { x: 100, y: 200, width: 80, height: 30 };
    for (let i = 0; i < 500; i++) {
      const p = pointInBox(box, rng);
      expect(p.x).toBeGreaterThanOrEqual(box.x + box.width * 0.15);
      expect(p.x).toBeLessThanOrEqual(box.x + box.width * 0.85);
      expect(p.y).toBeGreaterThanOrEqual(box.y + box.height * 0.15);
      expect(p.y).toBeLessThanOrEqual(box.y + box.height * 0.85);
    }
  });

  it('overshoots past the target in the direction of travel', () => {
    const rng = createRng(2);
    for (let i = 0; i < 50; i++) {
      const past = overshootPoint({ x: 0, y: 0 }, { x: 500, y: 0 }, rng);
      expect(past.x).toBeGreaterThan(500);
    }
  });
});

describe('neighbourKey', () => {
  it('returns a physically adjacent letter in the same case', () => {
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) {
      expect(['d', 'g', 'r', 't', 'c', 'v']).toContain(neighbourKey('f', rng));
      expect(['D', 'G', 'R', 'T', 'C', 'V']).toContain(neighbourKey('F', rng));
    }
  });

  it('leaves non-letters alone', () => {
    expect(neighbourKey('7', createRng())).toBeUndefined();
    expect(neighbourKey(' ', createRng())).toBeUndefined();
  });
});
