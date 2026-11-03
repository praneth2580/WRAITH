import type { Rng } from './random.js';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A path point plus how long to wait before moving to it. */
export interface TimedPoint extends Point {
  delay: number;
}

export interface PathOptions {
  /** Wobble per point, in pixels. */
  jitter: number;
  /** Width of the target. Smaller targets take longer to reach (Fitts's law). */
  targetWidth: number;
  /** Speed multiplier; 1 is an average person. */
  speed: number;
}

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * A point inside `box`, clustered around the centre the way real clicks are, and kept off the
 * outer 15% so it still lands on the element if the box is slightly off.
 */
export function pointInBox(box: Box, rng: Rng): Point {
  const padX = box.width * 0.15;
  const padY = box.height * 0.15;
  return {
    x: clamp(rng.gaussian(box.x + box.width / 2, box.width / 6), box.x + padX, box.x + box.width - padX),
    y: clamp(rng.gaussian(box.y + box.height / 2, box.height / 6), box.y + padY, box.y + box.height - padY),
  };
}

/** Fitts's law: time to reach a target grows with distance and shrinks with target size. */
export function movementDuration(distance: number, targetWidth: number, speed: number): number {
  const difficulty = Math.log2(distance / Math.max(targetWidth, 1) + 1);
  return (100 + 150 * difficulty) / Math.max(speed, 0.05);
}

/** Minimum-jerk profile: slow start, fast middle, slow finish, as measured in human reaching. */
const minimumJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * A curved, eased path from `from` to `to`. The cursor accelerates then slows into the target,
 * wobbles less as it arrives, and the last point is exactly `to`.
 */
export function humanPath(from: Point, to: Point, rng: Rng, options: PathOptions): TimedPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return [{ ...to, delay: 0 }];

  // Two control points pushed sideways off the straight line give the path a natural arc.
  const normal = { x: -dy / distance, y: dx / distance };
  const spread = clamp(distance * 0.25, 4, 180);
  const control = (along: number): Point => {
    const side = rng.gaussian(0, spread);
    return { x: from.x + dx * along + normal.x * side, y: from.y + dy * along + normal.y * side };
  };
  const c1 = control(rng.float(0.15, 0.45));
  const c2 = control(rng.float(0.55, 0.85));

  const duration = movementDuration(distance, options.targetWidth, options.speed);
  // About one pointer event every 12 ms, close to a real 60-120 Hz mouse.
  const steps = Math.round(clamp(duration / 12, 5, 120));
  const stepDelay = duration / steps;

  const points: TimedPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const delay = stepDelay * rng.float(0.7, 1.3);
    if (i === steps) {
      points.push({ x: to.x, y: to.y, delay });
      break;
    }
    const p = cubicBezier(from, c1, c2, to, minimumJerk(i / steps));
    const wobble = options.jitter * (1 - i / steps);
    points.push({ x: p.x + rng.gaussian(0, wobble), y: p.y + rng.gaussian(0, wobble), delay });
  }
  return points;
}

/** Where to land when overshooting: a little past `to` along the direction of travel. */
export function overshootPoint(from: Point, to: Point, rng: Rng): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const extra = clamp(distance * rng.float(0.04, 0.1), 6, 60);
  return {
    x: to.x + (dx / distance) * extra + rng.gaussian(0, extra * 0.3),
    y: to.y + (dy / distance) * extra + rng.gaussian(0, extra * 0.3),
  };
}
