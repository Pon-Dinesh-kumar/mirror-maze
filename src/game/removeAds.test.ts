import { before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PurchaseOutcome, PurchaseStatus, StoreProduct } from '../../modules/google-play';

/*
 * The Remove Ads entitlement (src/services/removeAds.ts) against a scripted Google Play. React, React Native, the
 * device storage and the native Billing module are stand-ins; the hook itself is the real one. Like React, the harness
 * re-renders only after the current task, so two taps in one slow frame both see the button as it was.
 */

// A minimal hooks runtime for one component.
type Slot = { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: void | (() => void) };
let slots: Slot[] = [];
let cursor = 0;
let effects: (() => void)[] = [];
let scheduled = false;
let component: (() => unknown) | undefined;
let rendered: unknown;
const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length || a.some((v, k) => !Object.is(v, b[k]));
function render() {
  scheduled = false;
  cursor = 0;
  rendered = component!();
  const run = effects;
  effects = [];
  run.forEach(effect => effect());
}
const rerender = () => { if (!scheduled) { scheduled = true; queueMicrotask(render); } };
const slot = () => (slots[cursor++] ??= {});
const react = {
  useState<T>(initial: T | (() => T)) {
    const s = slot();
    if (!('value' in s)) s.value = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [s.value as T, (next: T | ((previous: T) => T)) => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(s.value as T) : next;
      if (!Object.is(value, s.value)) { s.value = value; rerender(); }
    }] as const;
  },
  useRef<T>(initial: T) { const s = slot(); if (!('current' in s)) s.current = initial; return s as { current: T }; },
  useCallback<T>(fn: T, deps: unknown[]) { const s = slot(); if (changed(s.deps, deps)) { s.value = fn; s.deps = deps; } return s.value as T; },
  useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const s = slot();
    if (!changed(s.deps, deps)) return;
    s.deps = deps;
    effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = effect(); });
  },
};

// Device storage and app state.
const stored = new Map<string, string>();
const appState: ((state: string) => void)[] = [];
// Google Play, scripted per test.
const play = {
  owned: async (_id: string): Promise<boolean> => false,
  product: async (id: string): Promise<StoreProduct | null> => ({ id, title: 'Remove Ads', price: '₹99.00' }),
  buy: async (_id: string): Promise<PurchaseOutcome> => ({ status: 'cancelled', message: '', products: [] }),
  calls: { buy: 0, product: 0 },
  onPurchase: undefined as ((outcome: PurchaseOutcome) => void) | undefined,
};
const billing = {
  owned: (id: string) => play.owned(id),
  product: (id: string) => { play.calls.product++; return play.product(id); },
  buy: (id: string) => { play.calls.buy++; return play.buy(id); },
  addListener: (_event: string, listener: (outcome: PurchaseOutcome) => void) => { play.onPurchase = listener; return { remove() { play.onPurchase = undefined; } } },
};

mock.module('react', { namedExports: react, defaultExport: react });
mock.module('react-native', { namedExports: { AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
  appState.push(listener);
  return { remove() { appState.splice(appState.indexOf(listener), 1); } };
} } } });
mock.module('@react-native-async-storage/async-storage', { defaultExport: {
  getItem: async (key: string) => stored.get(key) ?? null,
  setItem: async (key: string, value: string) => { stored.set(key, value); },
  removeItem: async (key: string) => { stored.delete(key); },
} });
mock.module('expo', { namedExports: { NativeModule: class {}, requireOptionalNativeModule: (name: string) => (name === 'PlayBilling' ? billing : null) } });

type RemoveAds = ReturnType<typeof import('../services/removeAds').useRemoveAds>;
let useRemoveAds: () => RemoveAds;
before(async () => { ({ useRemoveAds } = await import('../services/removeAds')); });
const OWNED_KEY = 'mirror-maze:remove-ads';

/** Lets every pending promise, render and effect finish. */
const settle = async () => { for (let k = 0; k < 20; k++) await new Promise(resolve => setImmediate(resolve)); };
/** Mounts the hook as the app does at launch and waits for Google Play's first answers. */
async function launch() {
  slots = []; effects = []; scheduled = false;
  component = useRemoveAds;
  render();
  await settle();
  return () => rendered as RemoveAds;
}
/** A Google Play purchase sheet that stays open until the test closes it. */
function sheet() {
  let close!: (status: PurchaseStatus) => void;
  play.buy = () => new Promise(resolve => { close = status => resolve({ status, message: '', products: status === 'purchased' ? ['remove_ads'] : [] }); });
  return (status: PurchaseStatus) => close(status);
}

beforeEach(() => {
  stored.clear();
  play.owned = async () => false;
  play.product = async id => ({ id, title: 'Remove Ads', price: '₹99.00' });
  play.buy = async () => ({ status: 'cancelled', message: '', products: [] });
  play.calls = { buy: 0, product: 0 };
});

test('Remove Ads: the remembered purchase applies at launch and holds while Google Play cannot be reached', async () => {
  stored.set(OWNED_KEY, '1');
  play.owned = async () => { throw new Error('offline'); };
  const state = await launch();
  assert.equal(state().loaded, true);
  assert.equal(state().adFree, true);
  assert.equal(stored.get(OWNED_KEY), '1');
});

test('Remove Ads: Google Play decides at launch: a purchase from another phone or a reinstall appears, a refunded one goes', async () => {
  play.owned = async () => true;
  let state = await launch();
  assert.equal(state().adFree, true, 'owned on this Play account');
  assert.equal(stored.get(OWNED_KEY), '1');

  play.owned = async () => false;
  state = await launch();
  assert.equal(state().adFree, false, 'refunded');
  assert.equal(stored.has(OWNED_KEY), false);
});

test("Remove Ads: the price is Google Play's own, asked again after a failure and on returning to the game", async (t) => {
  const state = await launch();
  assert.equal(state().price, '₹99.00');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answers = 0;
  play.product = async id => { if (answers++ < 2) throw new Error('offline'); return { id, title: 'Remove Ads', price: '$1.99' }; };
  const offline = await launch();
  assert.equal(offline().price, undefined, 'no price is guessed');
  t.mock.timers.tick(5_000);
  await settle();
  assert.equal(offline().price, undefined);
  appState.forEach(listener => listener('active'));
  await settle();
  assert.equal(offline().price, '$1.99');
});

test('Remove Ads: only a purchase Google Play confirms (or reports already owned) removes the ads', async () => {
  for (const status of ['purchased', 'owned', 'cancelled', 'pending', 'unavailable', 'failed'] as PurchaseStatus[]) {
    stored.clear();
    play.buy = async () => ({ status, message: '', products: status === 'purchased' ? ['remove_ads'] : [] });
    const state = await launch();
    assert.equal(await state().buy(), status);
    await settle();
    const granted = status === 'purchased' || status === 'owned';
    assert.equal(state().adFree, granted, status);
    assert.equal(stored.get(OWNED_KEY), granted ? '1' : undefined, status);
    assert.equal(state().busy, false, status);
  }
});

test('Remove Ads: a Billing connection failure reports unavailable, removes nothing and frees the button', async () => {
  play.buy = async () => { throw new Error('Google Play Billing failed (3): API version 3 not supported'); };
  const state = await launch();
  assert.equal(await state().buy(), 'unavailable');
  await settle();
  assert.equal(state().adFree, false);
  assert.equal(state().busy, false);
});

test('Remove Ads: two taps before the button re-renders as busy open Google Play once and share its answer', async () => {
  const close = sheet();
  const state = await launch();
  const first = state().buy();
  const second = state().buy();
  assert.equal(play.calls.buy, 1, 'Google Play was asked to sell the same product twice');
  await settle();
  assert.equal(state().busy, true, 'the sheet is still open');
  close('purchased');
  assert.deepEqual(await Promise.all([first, second]), ['purchased', 'purchased']);
  await settle();
  assert.equal(state().adFree, true);
  assert.equal(state().busy, false);

  // Once the sheet has closed, a later tap asks Google Play again.
  play.buy = async () => ({ status: 'owned', message: '', products: [] });
  assert.equal(await state().buy(), 'owned');
  assert.equal(play.calls.buy, 2);
});

test('Remove Ads: a pending purchase that completes later removes the ads; other notices change nothing', async () => {
  const state = await launch();
  play.onPurchase!({ status: 'pending', message: '', products: [] });
  play.onPurchase!({ status: 'purchased', message: '', products: ['another_product'] });
  await settle();
  assert.equal(state().adFree, false);
  play.onPurchase!({ status: 'purchased', message: '', products: ['remove_ads'] });
  await settle();
  assert.equal(state().adFree, true);
  assert.equal(stored.get(OWNED_KEY), '1');
});

test('Remove Ads: restore asks Google Play: restored, not bought on this account (removes a stale copy), or no connection', async () => {
  play.owned = async () => { throw new Error('offline'); };
  const state = await launch();
  play.owned = async () => true;
  assert.equal(await state().restore(), 'restored');
  await settle();
  assert.equal(state().adFree, true);

  play.owned = async () => { throw new Error('offline'); };
  assert.equal(await state().restore(), 'failed');
  await settle();
  assert.equal(state().adFree, true, 'a failed check keeps what is known');

  play.owned = async () => false;
  assert.equal(await state().restore(), 'none');
  await settle();
  assert.equal(state().adFree, false);
  assert.equal(stored.has(OWNED_KEY), false);
});
