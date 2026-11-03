import type { Range } from './random.js';

/** Every knob that shapes how wraith imitates a person. All times are in milliseconds. */
export interface HumanBehavior {
  /** Master switch. When false, actions go straight to Playwright: no delays, paths or typos. */
  enabled: boolean;
  /** Pause before each action (click, type, select, press). */
  actionDelay: Range;
  mouse: {
    /** Move the cursor along a curved path before clicking. When false, clicks land without movement. */
    enabled: boolean;
    /** Speed multiplier. 1 is an average person; 2 is twice as fast. */
    speed: number;
    /** Chance (0-1) of overshooting a distant target and correcting back. */
    overshootChance: number;
    /** Random wobble added to each point of the path, in pixels. */
    jitter: number;
    /** Pause between reaching the target and pressing the button. */
    hoverDelay: Range;
    /** How long the button stays down. */
    clickHold: Range;
  };
  typing: {
    /** Pause after each character. */
    keyDelay: Range;
    /** Chance (0-1), per letter, of hitting a neighbouring key first and fixing it with Backspace. */
    typoChance: number;
    /** Extra pause after each space. */
    wordPause: Range;
  };
  scroll: {
    /** Pixels per wheel tick. */
    step: Range;
    /** Pause between wheel ticks. */
    stepDelay: Range;
  };
  reading: {
    /** Reading speed used by `page.read()`. */
    wordsPerMinute: Range;
  };
}

export type HumanPreset = 'off' | 'fast' | 'natural' | 'careful';

export const humanPresets: Readonly<Record<HumanPreset, HumanBehavior>> = {
  off: {
    enabled: false,
    actionDelay: [0, 0],
    mouse: { enabled: false, speed: 1, overshootChance: 0, jitter: 0, hoverDelay: [0, 0], clickHold: [0, 0] },
    typing: { keyDelay: [0, 0], typoChance: 0, wordPause: [0, 0] },
    scroll: { step: [100, 100], stepDelay: [0, 0] },
    reading: { wordsPerMinute: [250, 250] },
  },
  fast: {
    enabled: true,
    actionDelay: [60, 220],
    mouse: { enabled: true, speed: 2.5, overshootChance: 0.05, jitter: 1, hoverDelay: [20, 70], clickHold: [25, 60] },
    typing: { keyDelay: [15, 55], typoChance: 0, wordPause: [0, 40] },
    scroll: { step: [220, 420], stepDelay: [10, 40] },
    reading: { wordsPerMinute: [600, 900] },
  },
  natural: {
    enabled: true,
    actionDelay: [250, 900],
    mouse: { enabled: true, speed: 1, overshootChance: 0.15, jitter: 2, hoverDelay: [60, 220], clickHold: [50, 130] },
    typing: { keyDelay: [55, 170], typoChance: 0.02, wordPause: [60, 250] },
    scroll: { step: [80, 180], stepDelay: [30, 110] },
    reading: { wordsPerMinute: [200, 300] },
  },
  careful: {
    enabled: true,
    actionDelay: [600, 2200],
    mouse: { enabled: true, speed: 0.7, overshootChance: 0.25, jitter: 3, hoverDelay: [150, 450], clickHold: [70, 180] },
    typing: { keyDelay: [90, 260], typoChance: 0.035, wordPause: [120, 500] },
    scroll: { step: [60, 140], stepDelay: [60, 200] },
    reading: { wordsPerMinute: [150, 230] },
  },
};
