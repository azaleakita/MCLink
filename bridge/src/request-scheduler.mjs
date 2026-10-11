import { setTimeout as delay } from 'node:timers/promises';

function abortedWait(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function retryAfterMs(value, now = Date.now()) {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

// One lane per origin, shared by decisions, conversation, API tests and model lists.
// Credentials and model IDs never enter the lane key or diagnostics.
export class RequestScheduler {
  constructor({ rateLimitBaseMs = 15000, transientBaseMs = 1000, maxBackoffMs = 120000, jitter = Math.random } = {}) {
    this.lanes = new Map();
    Object.assign(this, { rateLimitBaseMs, transientBaseMs, maxBackoffMs, jitter });
  }
  lane(profile) {
    const key = new URL(profile.baseUrl).origin;
    if (!this.lanes.has(key)) this.lanes.set(key, { tail: Promise.resolve(), lastStarted: 0, lastInterval: 0, cooldownUntil: 0, failures: 0, rateLimits: 0, successes: 0 });
    return this.lanes.get(key);
  }
  async run(profile, signal, onWait, request) {
    const lane = this.lane(profile), previous = lane.tail;
    let release;
    const reservation = new Promise(resolve => { release = resolve; });
    lane.tail = previous.then(() => reservation);
    const interval = (profile.requestIntervalSeconds ?? (profile.protocol === 'ollama' ? 0 : 8)) * 1000;
    try {
      signal?.throwIfAborted();
      onWait?.({ reason: 'queue', delayMs: 0 });
      await abortedWait(previous, signal);
      for (;;) {
        signal?.throwIfAborted();
        const adaptive = lane.rateLimits ? Math.min(this.maxBackoffMs, this.rateLimitBaseMs * 2 ** (lane.rateLimits - 1)) : 0;
        const next = Math.max(lane.cooldownUntil, lane.lastStarted + Math.max(interval, lane.lastInterval, adaptive));
        const waitMs = next - Date.now();
        if (waitMs <= 0) break;
        onWait?.({ reason: lane.cooldownUntil > Date.now() ? 'cooldown' : 'interval', delayMs: waitMs });
        // Recheck long server deadlines in bounded, abortable chunks.
        await delay(Math.min(waitMs, 60000), undefined, { signal });
      }
      signal?.throwIfAborted();
      lane.lastStarted = Date.now(); lane.lastInterval = interval;
      return await request();
    } finally { release(); }
  }
  succeeded(profile) {
    const lane = this.lane(profile);
    lane.failures = 0;
    // Recover gradually; a single successful reply does not remove rate-limit protection.
    if (++lane.successes >= 3) { lane.rateLimits = Math.max(0, lane.rateLimits - 1); lane.successes = 0; }
  }
  failed(profile, status, retryAfter = 0) {
    const lane = this.lane(profile);
    lane.failures++;
    lane.successes = 0;
    if (status === 429) lane.rateLimits = Math.min(8, lane.rateLimits + 1);
    const base = status === 429 ? this.rateLimitBaseMs : this.transientBaseMs;
    const exponent = status === 429 ? lane.rateLimits : Math.min(8, lane.failures);
    const backoff = Math.min(this.maxBackoffMs, base * 2 ** (exponent - 1));
    const duration = Math.max(retryAfter, backoff + Math.round(backoff * 0.2 * this.jitter()));
    lane.cooldownUntil = Math.max(lane.cooldownUntil, Date.now() + duration);
    return duration;
  }
}

export const requestScheduler = new RequestScheduler();
