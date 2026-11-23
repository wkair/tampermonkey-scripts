const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(`${__dirname}/src/main.js`, 'utf8');
const A = '/manhwa/10454/103310';
const B = '/manhwa/10454/103311';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 3; i++) await tick(); }

function harness(t, { html, count = 6, missing = [], mobile = true, navigation = true, storage = {}, storageBlocked = false } = {}) {
  const dom = new JSDOM(html || '<div class="theme-viewer-nav"></div><div data-theme-viewer-images></div><script id="theme-viewer-data" type="application/json"></script>', {
    url: `https://newtoki1.org${A}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const d = w.document;
  const errors = [];
  w.console.error = (...args) => errors.push(args);
  w.navigation = navigation ? new w.EventTarget() : undefined;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  if (storageBlocked) Object.defineProperty(w, 'localStorage', { get() { throw new Error('storage denied'); } });
  if (mobile) Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (Android 14; Mobile) Firefox/132.0' });
  if (!html) {
    const area = d.querySelector('[data-theme-viewer-images]');
    for (let i = 1; i <= count; i++) {
      const slot = d.createElement('div');
      slot.dataset.themePage = String(i);
      area.append(slot);
      if (!missing.includes(i)) slot.innerHTML = `<img src="https://images.example/${i}.webp">`;
    }
    d.getElementById('theme-viewer-data').textContent = JSON.stringify({ scopePath: A, images: Array.from({ length: count }, (_, i) => ({ page: i + 1 })) });
  }
  w.eval(script.replace('  start();\n})();', '  window.testAPI = { start, collectSnapshot, spreadStarts };\n})();'));
  const cleanup = w.testAPI.start();
  t.after(() => { cleanup(); w.close(); });
  const h = {
    w, d, errors, cleanup,
    open: () => [...d.querySelectorAll('button')].find(b => b.textContent === '두 쪽 보기').click(),
    viewer: () => d.querySelector('[data-toki-spread-viewer]'),
    count: () => d.querySelector('[data-toki-page-count]')?.textContent,
    pages: () => [...d.querySelectorAll('[data-toki-page]')].filter(p => p.style.visibility !== 'hidden').map(p => p.dataset.tokiPage),
    button: text => [...d.querySelectorAll('[data-toki-spread-viewer] button')].find(b => b.textContent === text),
    key: key => w.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    navigate: path => { w.history.pushState({}, '', path); w.navigation?.dispatchEvent(new w.Event('navigatesuccess')); },
  };
  return h;
}
function putImage(h, page, url = `https://images.example/${page}.webp`) {
  const slot = h.d.querySelector(`[data-theme-page="${page}"]`);
  const img = h.d.createElement('img');
  img.src = url;
  slot.replaceChildren(img);
  return img;
}
function setScope(h, path) {
  const data = h.d.getElementById('theme-viewer-data');
  const config = JSON.parse(data.textContent);
  config.scopePath = path;
  data.textContent = JSON.stringify(config);
}
function touch(h, node, type, x = 20, y = 20) {
  const point = { identifier: 1, clientX: x, clientY: y };
  const e = new h.w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] },
    changedTouches: { value: [point] },
  });
  node.dispatchEvent(e);
  return e;
}

function gestureTimers(h) {
  const nativeSet = h.w.setTimeout.bind(h.w);
  const nativeClear = h.w.clearTimeout.bind(h.w);
  const pending = new Map();
  let id = -1;
  h.w.setTimeout = (callback, delay, ...args) => {
    if (![320, 550].includes(delay)) return nativeSet(callback, delay, ...args);
    pending.set(id, { callback, delay });
    return id--;
  };
  h.w.clearTimeout = timer => { if (!pending.delete(timer)) nativeClear(timer); };
  return {
    flush(delay) {
      for (const [timer, task] of [...pending]) {
        if (task.delay === delay && pending.delete(timer)) task.callback();
      }
    },
    size: () => pending.size,
  };
}

function pageSettings(h, page) {
  const frame = h.viewer().querySelector(`[data-toki-page="${page}"]`);
  frame.dispatchEvent(new h.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return h.viewer().querySelector('[data-toki-page-popup]');
}

test('there is one viewer action and Android Firefox opens two fitted pages side by side', t => {
  const h = harness(t);
  assert.deepEqual([...h.d.querySelectorAll('button')].map(b => b.textContent), ['두 쪽 보기']);
  h.open();
  assert.ok(h.viewer());
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.equal(h.count(), '1–2 / 6');
  assert.equal(h.viewer().querySelectorAll('img').length, 2, 'only the current spread is requested');
  const spread = h.d.querySelector('[data-toki-spread]');
  assert.equal(spread.style.display, 'flex');
  assert.equal(spread.style.flexDirection, 'row-reverse', 'page 1 on the right');
  h.viewer().querySelectorAll('[data-toki-page]').forEach(page => assert.equal(page.style.width, '50%'));
  h.viewer().querySelectorAll('img').forEach(img => {
    assert.equal(img.style.objectFit, 'contain');
    assert.equal(img.referrerPolicy, 'no-referrer');
  });
});

test('next and previous move by a spread and keep the final odd page', t => {
  const h = harness(t, { count: 5 });
  h.open();
  assert.equal(h.button('이전 2쪽').disabled, true);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['5']);
  assert.equal(h.count(), '5 / 5');
  assert.equal(h.button('다음 2쪽').disabled, true);
  assert.equal(h.viewer().querySelectorAll('img').length, 1);
  h.button('이전 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('a single-page chapter has a blank second cell without a ghost retry button', t => {
  const h = harness(t, { count: 1 });
  h.open();
  assert.deepEqual(h.pages(), ['1']);
  const cells = h.viewer().querySelectorAll('[data-toki-page]');
  assert.equal(cells[1].style.visibility, 'hidden');
  assert.equal(h.button('다음 2쪽').disabled, true);
});

test('optional cover offset pairs pages 2–3 instead of silently skipping page 1', t => {
  const h = harness(t, { count: 6 });
  h.open();
  h.button('첫 장 단독').click();
  assert.equal(h.button('첫 장 단독').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(h.pages(), ['1']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
  h.button('첫 장 단독').click();
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('cover sits on the left for RTL and right for LTR without reversing later pairs', t => {
  const h = harness(t);
  h.open();
  h.button('첫 장 단독').click();
  const spread = h.d.querySelector('[data-toki-spread]');
  assert.equal(spread.style.flexDirection, 'row');
  assert.equal(spread.querySelector('img').style.objectPosition, 'right center');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
  assert.equal(spread.style.flexDirection, 'row-reverse');
  h.button('이전 2쪽').click();
  h.button('읽기: 우→좌').click();
  assert.equal(spread.style.flexDirection, 'row-reverse');
  assert.equal(spread.querySelector('img').style.objectPosition, 'left center');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
  assert.equal(spread.style.flexDirection, 'row');
});

test('horizontal spare space stays outside while height overflow crops at the gutter in both directions', t => {
  const h = harness(t);
  h.open();
  const images = [...h.viewer().querySelectorAll('img')];
  for (const image of images) {
    Object.defineProperties(image.parentElement, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 600 },
    });
    imageSize(image, 900, 900);
  }
  const check = (width, height, positions, edges) => {
    assert.deepEqual([...h.viewer().querySelectorAll('img')], images);
    for (const [index, image] of images.entries()) {
      const edge = edges?.[index];
      assert.equal(image.style.width, width);
      assert.equal(image.style.height, height);
      assert.equal(image.style.maxWidth, 'none');
      assert.equal(image.style.maxHeight, 'none');
      assert.equal(image.style.left, edge ? (edge === 'left' ? '0px' : 'auto') : '50%');
      assert.equal(image.style.right, edge ? (edge === 'right' ? '0px' : 'auto') : '');
      assert.equal(image.style.top, '50%');
      assert.equal(image.style.transform, edge ? 'translateY(-50%)' : 'translate(-50%,-50%)');
      assert.equal(image.style.objectPosition, `${positions[index]} center`);
      assert.equal(image.parentElement.style.width, '50%');
      assert.equal(image.parentElement.style.overflow, 'hidden');
    }
  };
  check('100%', '100%', ['left', 'right']);
  h.button('화면 맞춤').click();
  check('auto', '100%', ['right', 'left'], ['right', 'left']);
  h.button('읽기: 우→좌').click();
  check('auto', '100%', ['left', 'right'], ['left', 'right']);
  for (const image of images) {
    imageSize(image, 300, 900);
    image.dispatchEvent(new h.w.Event('load'));
  }
  check('auto', '100%', ['right', 'left'], ['right', 'left']);
  h.button('읽기: 좌→우').click();
  check('auto', '100%', ['left', 'right'], ['left', 'right']);
  // Rotation can turn a narrow page into an overflowing one without a new load.
  for (const image of images) Object.defineProperty(image.parentElement, 'clientWidth', { configurable: true, value: 150 });
  h.w.dispatchEvent(new h.w.Event('resize'));
  check('auto', '100%', ['right', 'left'], ['right', 'left']);
  h.button('높이 맞춤').click();
  check('100%', 'auto', ['left', 'right']);
  h.button('폭 맞춤').click();
  check('100%', '100%', ['left', 'right']);
});

for (const mode of ['contain', 'height', 'width']) {
  test(`fit ${mode} and reading direction persist after reopening and a fresh page`, t => {
    const h = harness(t);
    h.open();
    h.button('화면 맞춤').click();
    if (mode !== 'height') h.button('높이 맞춤').click();
    if (mode === 'contain') h.button('폭 맞춤').click();
    h.button('읽기: 우→좌').click();
    const storage = Object.fromEntries(Object.entries(h.w.localStorage));
    assert.equal(storage['toki-viewer.image-fit'], mode);
    assert.equal(storage['toki-viewer.reading-direction'], 'ltr');
    h.button('닫기').click();
    h.open();
    assert.equal(h.viewer().querySelector('[data-toki-fit]').dataset.tokiFit, mode);
    assert.ok(h.button('읽기: 좌→우'));
    const fresh = harness(t, { storage });
    fresh.open();
    assert.equal(fresh.viewer().querySelector('[data-toki-fit]').dataset.tokiFit, mode);
    assert.ok(fresh.button('읽기: 좌→우'));
    fresh.button('읽기: 좌→우').click();
    assert.equal(fresh.w.localStorage.getItem('toki-viewer.reading-direction'), 'rtl');
  });
}

test('fit, direction and cover preferences carry into the automatically opened next chapter', async t => {
  const h = harness(t);
  const next = episodeLink(h, 'next', B);
  next.addEventListener('click', event => { event.preventDefault(); h.navigate(B); });
  h.open();
  h.button('화면 맞춤').click();
  h.button('높이 맞춤').click();
  h.button('읽기: 우→좌').click();
  h.button('첫 장 단독').click();
  h.button('다음화').click();
  setScope(h, B);
  for (let page = 1; page <= 6; page++) putImage(h, page, `https://images.example/next${page}.webp`);
  await settle();
  assert.ok(h.button('폭 맞춤'));
  assert.ok(h.button('읽기: 좌→우'));
  assert.deepEqual(h.pages(), ['1']);
  assert.equal(h.viewer().querySelector('img').style.height, 'auto');
  assert.equal(h.viewer().querySelector('[data-toki-spread]').style.flexDirection, 'row-reverse');
});

test('blocked storage preserves fit and direction during reopening and invalid values use defaults', t => {
  const h = harness(t, { storageBlocked: true });
  h.open();
  h.button('화면 맞춤').click();
  h.button('읽기: 우→좌').click();
  h.button('닫기').click();
  h.open();
  assert.ok(h.button('높이 맞춤'));
  assert.ok(h.button('읽기: 좌→우'));
  assert.deepEqual(h.errors, []);
  const invalid = harness(t, { storage: { 'toki-viewer.image-fit': 'invalid', 'toki-viewer.reading-direction': 'invalid' } });
  invalid.open();
  assert.ok(invalid.button('화면 맞춤'));
  assert.ok(invalid.button('읽기: 우→좌'));
});

test('fit works with cover, combined pages, cached next pages and image retries', t => {
  const h = harness(t);
  sourceSize(h, 2);
  h.open();
  h.button('화면 맞춤').click();
  h.button('첫 장 단독').click();
  const cover = h.viewer().querySelector('img');
  Object.defineProperties(cover.parentElement, { clientWidth: { value: 400 }, clientHeight: { value: 600 } });
  imageSize(cover, 900, 900);
  cover.dispatchEvent(new h.w.Event('load'));
  assert.equal(cover.style.left, '0px');
  assert.equal(cover.style.objectPosition, 'left center');
  assert.equal(cover.parentElement.style.width, '50%');
  h.button('읽기: 우→좌').click();
  assert.equal(cover.style.right, '0px');
  assert.equal(cover.style.objectPosition, 'right center');
  h.button('읽기: 좌→우').click();
  h.button('다음 2쪽').click();
  const combined = h.viewer().querySelector('img');
  assert.equal(combined.parentElement.style.width, '100%');
  assert.equal(combined.style.width, 'auto');
  assert.equal(combined.style.height, '100%');
  assert.equal(combined.style.objectPosition, 'center');
  assert.equal(combined.style.left, '50%');
  h.button('다음 2쪽').click();
  for (const image of h.viewer().querySelectorAll('img')) assert.equal(image.style.width, 'auto');
  h.viewer().querySelector('img').dispatchEvent(new h.w.Event('error'));
  h.button('다시 시도').click();
  const retried = h.viewer().querySelector('img');
  imageSize(retried, 900, 900);
  retried.dispatchEvent(new h.w.Event('load'));
  assert.equal(retried.style.width, 'auto');
  assert.equal(retried.style.objectPosition, 'right center');
  assert.equal(retried.style.right, '0px');
});

test('switching fit resets pinch and double tap restores the selected fit without erasing preference', t => {
  const h = zoomHarness(t);
  h.pinch();
  h.button('화면 맞춤').click();
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
  h.pinch();
  assert.match(h.spread.style.transform, /scale\(2\)/);
  for (let i = 0; i < 2; i++) {
    touch(h, h.spread, 'touchstart', 200, 200);
    touch(h, h.spread, 'touchend', 200, 200);
  }
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
  assert.ok(h.button('높이 맞춤'));
  assert.equal(h.w.localStorage.getItem('toki-viewer.image-fit'), 'height');
  assert.equal(h.spread.querySelector('img').style.width, 'auto');
});

function zoomHarness(t) {
  const h = harness(t);
  h.open();
  h.viewport = h.d.querySelector('[data-toki-viewport]');
  h.spread = h.d.querySelector('[data-toki-spread]');
  h.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  h.multiTouch = (type, points, changed = points) => {
    const list = values => values.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY }));
    const event = new h.w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: list(points) }, changedTouches: { value: list(changed) } });
    h.spread.dispatchEvent(event);
    return event;
  };
  h.pinch = (distance = 200) => {
    h.multiTouch('touchstart', [[1, 350, 300], [2, 450, 300]]);
    h.multiTouch('touchmove', [[1, 400 - distance / 2, 300], [2, 400 + distance / 2, 300]]);
    h.multiTouch('touchend', [], [[1, 400 - distance / 2, 300], [2, 400 + distance / 2, 300]]);
  };
  return h;
}

test('pinch zoom is continuous, clamped, and reuses images without adding zoom buttons', t => {
  const h = zoomHarness(t);
  const images = [...h.spread.querySelectorAll('img')];
  const buttons = [...h.viewer().querySelectorAll('button')].map(button => button.textContent);
  h.pinch(175);
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1.75)');
  h.pinch(400);
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(4)');
  h.pinch(10);
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
  assert.deepEqual([...h.spread.querySelectorAll('img')], images);
  assert.deepEqual([...h.viewer().querySelectorAll('button')].map(button => button.textContent), buttons);
  assert.equal(h.button('확대'), undefined);
  assert.equal(h.button('축소'), undefined);
});

test('pinch anchors the touched content and consumes the remaining finger without turning pages', t => {
  const h = zoomHarness(t);
  h.multiTouch('touchstart', [[1, 150, 200], [2, 250, 200]]);
  assert.equal(h.multiTouch('touchmove', [[1, 100, 200], [2, 300, 200]]).defaultPrevented, true);
  assert.equal(h.spread.style.transform, 'translate(200px, 100px) scale(2)');
  h.multiTouch('touchend', [[1, 100, 200]], [[2, 300, 200]]);
  h.multiTouch('touchmove', [[1, 500, 200]]);
  h.multiTouch('touchend', [], [[1, 500, 200]]);
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.equal(h.spread.style.transform, 'translate(200px, 100px) scale(2)');
});

test('zoomed dragging pans within bounds, suppresses clicks, and double tap restores fit', t => {
  const h = zoomHarness(t);
  h.pinch();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  touch(h, h.spread, 'touchstart', 100, 100);
  touch(h, h.spread, 'touchmove', 1000, 1000);
  touch(h, h.spread, 'touchend', 1000, 1000);
  assert.equal(h.spread.style.transform, 'translate(400px, 300px) scale(2)');
  assert.deepEqual(h.pages(), ['1', '2']);
  h.spread.click();
  assert.equal(toolbar.hidden, false);
  for (let i = 0; i < 2; i++) {
    touch(h, h.spread, 'touchstart', 200, 200);
    touch(h, h.spread, 'touchend', 200, 200);
  }
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
  assert.equal(toolbar.hidden, false);
  touch(h, h.spread, 'touchstart', 50, 100);
  touch(h, h.spread, 'touchend', 150, 100);
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('two distant taps do not reset zoom and cancellation cannot become a page swipe', t => {
  const h = zoomHarness(t);
  h.pinch();
  for (const x of [100, 400]) {
    touch(h, h.spread, 'touchstart', x, 200);
    touch(h, h.spread, 'touchend', x, 200);
  }
  assert.match(h.spread.style.transform, /scale\(2\)/);
  h.multiTouch('touchstart', [[1, 150, 200], [2, 250, 200]]);
  h.multiTouch('touchcancel', []);
  touch(h, h.spread, 'touchend', 700, 200);
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.match(h.spread.style.transform, /scale\(2\)/);
});

test('page changes reset zoom but an unchanged source refresh preserves it', async t => {
  const h = zoomHarness(t);
  h.pinch();
  h.d.querySelector('[data-theme-page="1"] img').dispatchEvent(new h.w.Event('load'));
  await settle();
  assert.match(h.spread.style.transform, /scale\(2\)/);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
  h.pinch();
  h.button('읽기: 우→좌').click();
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
});

test('mouse drag and arrow keys pan zoomed content, resize clamps pan, double click resets', t => {
  const h = zoomHarness(t);
  h.pinch();
  h.viewport.setPointerCapture = () => {};
  const pointer = (type, x, y) => {
    const event = new h.w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
    h.spread.dispatchEvent(event);
  };
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 400, 300);
  pointer('pointerup', 400, 300);
  assert.equal(h.spread.style.transform, 'translate(300px, 200px) scale(2)');
  h.key('ArrowLeft');
  assert.equal(h.spread.style.transform, 'translate(380px, 200px) scale(2)');
  assert.deepEqual(h.pages(), ['1', '2']);
  h.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(h.spread.style.transform, 'translate(200px, 150px) scale(2)');
  h.spread.dispatchEvent(new h.w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(h.spread.style.transform, 'translate(0px, 0px) scale(1)');
});

test('cover preference keeps both on and off choices after closing and reopening', t => {
  const h = harness(t);
  h.open();
  h.button('첫 장 단독').click();
  h.button('닫기').click();
  h.open();
  assert.deepEqual(h.pages(), ['1']);
  assert.equal(h.button('첫 장 단독').getAttribute('aria-pressed'), 'true');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
  h.button('첫 장 단독').click();
  h.button('닫기').click();
  h.open();
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.equal(h.button('첫 장 단독').getAttribute('aria-pressed'), 'false');
});

test('cover preference is restored by a fresh page instance, including turning it off', t => {
  const first = harness(t);
  first.open();
  first.button('첫 장 단독').click();
  const saved = h => Object.fromEntries(Array.from({ length: h.w.localStorage.length }, (_, i) => {
    const key = h.w.localStorage.key(i);
    return [key, h.w.localStorage.getItem(key)];
  }));
  const reloaded = harness(t, { storage: saved(first) });
  reloaded.open();
  assert.deepEqual(reloaded.pages(), ['1']);
  assert.equal(reloaded.button('첫 장 단독').getAttribute('aria-pressed'), 'true');
  reloaded.button('첫 장 단독').click();
  const off = harness(t, { storage: saved(reloaded) });
  off.open();
  assert.deepEqual(off.pages(), ['1', '2']);
  assert.equal(off.button('첫 장 단독').getAttribute('aria-pressed'), 'false');
});

test('automatic next-chapter resume retains cover pairing', async t => {
  const h = harness(t);
  const next = episodeLink(h, 'next', B);
  next.addEventListener('click', e => { e.preventDefault(); h.navigate(B); });
  h.open();
  h.button('첫 장 단독').click();
  h.button('다음화').click();
  setScope(h, B);
  for (let page = 1; page <= 6; page++) putImage(h, page, `https://images.example/next${page}.webp`);
  await settle();
  assert.ok(h.viewer());
  assert.deepEqual(h.pages(), ['1']);
  assert.equal(h.button('첫 장 단독').getAttribute('aria-pressed'), 'true');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
});

test('blocked browser storage still permits cover changes and retains them while the page is open', t => {
  const h = harness(t, { storageBlocked: true });
  h.open();
  h.button('첫 장 단독').click();
  assert.deepEqual(h.pages(), ['1']);
  h.button('닫기').click();
  h.open();
  assert.deepEqual(h.pages(), ['1']);
  assert.deepEqual(h.errors, []);
});

test('reading-direction toggle changes visual order and arrow-key direction', t => {
  const h = harness(t);
  h.open();
  h.key('ArrowLeft');
  assert.deepEqual(h.pages(), ['3', '4']);
  h.button('읽기: 우→좌').click();
  assert.equal(h.d.querySelector('[data-toki-spread]').style.flexDirection, 'row');
  h.key('ArrowRight');
  assert.deepEqual(h.pages(), ['5', '6']);
  h.key('ArrowLeft');
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('i/j/k work and viewer keys do not reach the site episode navigator', t => {
  const h = harness(t);
  let siteKeys = 0;
  h.d.addEventListener('keydown', () => siteKeys++);
  h.key('i');
  assert.ok(h.viewer());
  h.d.body.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(siteKeys, 0);
  assert.deepEqual(h.pages(), ['3', '4']);
  h.key('k');
  assert.deepEqual(h.pages(), ['1', '2']);
  h.key('j');
  assert.deepEqual(h.pages(), ['3', '4']);
  h.key('i');
  assert.equal(h.viewer(), null);
});

test('a rightward swipe advances an RTL spread, vertical movement does not', t => {
  const h = harness(t);
  h.open();
  const spread = h.d.querySelector('[data-toki-spread]');
  touch(h, spread, 'touchstart', 50, 100);
  touch(h, spread, 'touchend', 150, 105);
  assert.deepEqual(h.pages(), ['3', '4']);
  touch(h, spread, 'touchstart', 50, 100);
  touch(h, spread, 'touchend', 55, 250);
  assert.deepEqual(h.pages(), ['3', '4']);
  touch(h, spread, 'touchstart', 150, 100);
  touch(h, spread, 'touchend', 50, 100);
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('missing pages reserve their half and are filled without changing the current spread', async t => {
  const h = harness(t, { missing: [2] });
  h.open();
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.equal(h.viewer().querySelectorAll('img').length, 1);
  putImage(h, 2);
  await settle();
  assert.equal(h.viewer().querySelectorAll('img').length, 2);
  assert.deepEqual(h.pages(), ['1', '2']);
  h.button('다음 2쪽').click();
  putImage(h, 2, 'https://images.example/updated2.webp');
  await settle();
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('a failed image can be retried without reloading its partner', t => {
  const h = harness(t);
  h.open();
  const cells = h.viewer().querySelectorAll('[data-toki-page]');
  const first = cells[0].querySelector('img');
  const second = cells[1].querySelector('img');
  first.dispatchEvent(new h.w.Event('error'));
  const retry = cells[0].querySelector('button');
  assert.equal(retry.hidden, false);
  retry.click();
  assert.notEqual(cells[0].querySelector('img'), first);
  assert.equal(cells[1].querySelector('img'), second);
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('missing source slots update failure and recovery messages without reloading their partner', async t => {
  const h = harness(t, { missing: [2] });
  h.open();
  const partner = h.viewer().querySelector('img');
  const slot = h.d.querySelector('[data-theme-page="2"]');
  const frame = h.viewer().querySelector('[data-toki-page="2"]');
  slot.classList.add('is-error');
  await settle();
  assert.match(frame.textContent, /원본 이미지 로딩 실패/);
  assert.equal(frame.querySelector('button').hidden, true, 'there is no URL to retry yet');
  assert.equal(h.viewer().querySelector('img'), partner);
  slot.classList.remove('is-error');
  await settle();
  assert.match(frame.textContent, /이미지 준비 중/);
  putImage(h, 2);
  await settle();
  assert.equal(frame.querySelector('img').src, 'https://images.example/2.webp');
  assert.equal(h.viewer().querySelector('img'), partner);
});

test('close, Escape and cleanup restore the original overflow style', t => {
  const h = harness(t);
  h.d.documentElement.style.setProperty('overflow', 'scroll', 'important');
  h.open();
  assert.equal(h.d.documentElement.style.overflow, 'hidden');
  h.key('Escape');
  assert.equal(h.viewer(), null);
  assert.equal(h.d.documentElement.style.overflow, 'scroll');
  assert.equal(h.d.documentElement.style.getPropertyPriority('overflow'), 'important');
  h.open();
  h.cleanup();
  assert.equal(h.viewer(), null);
  assert.equal(h.d.querySelector('[data-toki-viewer-ui]'), null);
  assert.equal(h.d.documentElement.style.overflow, 'scroll');
});

test('navigation closes the old spread and rejects unchanged old image nodes', async t => {
  const h = harness(t);
  h.open();
  h.navigate(B);
  assert.equal(h.viewer(), null);
  setScope(h, B);
  await settle();
  h.open();
  assert.equal(h.viewer().querySelectorAll('img').length, 0);
  putImage(h, 1, 'https://images.example/new1.webp');
  putImage(h, 2, 'https://images.example/new2.webp');
  await settle();
  assert.deepEqual([...h.viewer().querySelectorAll('img')].map(i => i.src), ['https://images.example/new1.webp', 'https://images.example/new2.webp']);
});

test('DOM-before-URL navigation does not reject the new chapter', async t => {
  const h = harness(t);
  setScope(h, B);
  putImage(h, 1, 'https://images.example/new1.webp');
  await settle();
  h.navigate(B);
  h.open();
  assert.equal(h.viewer().querySelector('img').src, 'https://images.example/new1.webp');
});

test('touch-only open survives overwritten onclick and suppresses a duplicate click', t => {
  const h = harness(t);
  const button = h.d.querySelector('button');
  button.onclick = null;
  touch(h, button, 'touchstart');
  touch(h, button, 'touchend');
  assert.ok(h.viewer());
  h.button('닫기').click();
  button.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(h.viewer(), null);
});

test('new reported page fixture contains 33 slots and exposes only two images per spread', async t => {
  const html = fs.readFileSync(`${__dirname}/fixtures/newtoki-mobile.html`, 'utf8');
  const h = harness(t, { html });
  for (let page = 1; page <= 33; page++) putImage(h, page);
  await settle();
  h.open();
  assert.equal(h.count(), '1–2 / 33');
  for (let turn = 0; turn < 16; turn++) h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['33']);
  assert.equal(h.viewer().querySelectorAll('img').length, 1);
});

test('two-page reading works without runtime libraries when fullscreen is unsupported', t => {
  const h = harness(t, { mobile: false });
  h.open();
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.doesNotMatch(script, /@require|@resource|vim_comic_viewer|createSimpleViewer/);
  assert.doesNotMatch(h.d.body.textContent, /간편 뷰어/);
});

test('typing i in an input does not open the reader', t => {
  const h = harness(t);
  const input = h.d.createElement('input');
  h.d.body.append(input);
  input.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'i', bubbles: true }));
  assert.equal(h.viewer(), null);
});

function fullscreenAPI(h, { reject = false, deferred = false } = {}) {
  let current = null;
  let resolveRequest;
  let calls = 0;
  let exits = 0;
  Object.defineProperty(h.d, 'fullscreenElement', { get: () => current, configurable: true });
  Object.defineProperty(h.d, 'fullscreenEnabled', { value: true, configurable: true });
  const change = value => { current = value; h.d.dispatchEvent(new h.w.Event('fullscreenchange')); };
  h.d.documentElement.requestFullscreen = function(options) {
    calls++;
    assert.equal(this, h.d.documentElement, 'dialog elements are not eligible for fullscreen');
    assert.equal(options.navigationUI, 'hide');
    if (reject) return Promise.reject(new Error('permission denied'));
    if (deferred) return new Promise(resolve => { resolveRequest = () => { change(h.d.documentElement); resolve(); }; });
    change(h.d.documentElement);
    return Promise.resolve();
  };
  h.d.exitFullscreen = () => { exits++; change(null); return Promise.resolve(); };
  return { get calls() { return calls; }, get exits() { return exits; }, change, resolve: () => resolveRequest() };
}

test('manual viewer entry requests fullscreen synchronously within the opening tap', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  const open = h.d.querySelector('button');
  touch(h, open, 'touchstart');
  touch(h, open, 'touchend');
  assert.equal(fs.calls, 1, 'request must happen before the opening tap returns');
  await settle();
  assert.equal(h.d.fullscreenElement, h.d.documentElement);
  assert.ok(h.button('전체화면 해제'));
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  h.button('전체화면 해제').click();
  await settle();
  assert.equal(h.d.fullscreenElement, null);
  assert.ok(h.viewer());
});

test('closing the reader exits fullscreen owned by it', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  h.open();
  await settle();
  h.button('닫기').click();
  assert.equal(fs.exits, 1);
  assert.equal(h.d.fullscreenElement, null);
  assert.equal(h.viewer(), null);
});

test('manual browser fullscreen exit updates the button without closing the comic', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  h.open();
  await settle();
  fs.change(null);
  assert.ok(h.button('전체화면'));
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('rejected fullscreen leaves two-page reading usable and permits retry', async t => {
  const h = harness(t);
  fullscreenAPI(h, { reject: true });
  h.open();
  await settle();
  assert.match(h.viewer().textContent, /전체화면 요청이 거절됐습니다/);
  assert.equal(h.button('전체화면').disabled, false);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
});

test('late fullscreen success after closing is immediately exited', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h, { deferred: true });
  h.open();
  h.button('닫기').click();
  fs.resolve();
  await settle();
  assert.equal(fs.exits, 1);
  assert.equal(h.d.fullscreenElement, null);
});

test('reader close does not exit fullscreen that was already active beforehand', t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  fs.change(h.d.documentElement);
  h.open();
  h.button('닫기').click();
  assert.equal(fs.exits, 0);
});

test('modal is put above the fullscreen root on entering fullscreen', async t => {
  const h = harness(t);
  h.open();
  fullscreenAPI(h);
  const dialog = h.viewer();
  let reopens = 0;
  dialog.close = () => dialog.removeAttribute('open');
  dialog.showModal = () => { reopens++; dialog.setAttribute('open', ''); };
  h.button('전체화면').click();
  await settle();
  assert.equal(reopens, 1);
  assert.ok(dialog.open);
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('controls overlay the full-height spread instead of reserving image height', t => {
  const h = harness(t);
  h.open();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  const spread = h.viewer().querySelector('[data-toki-spread]');
  assert.equal(toolbar.style.position, 'absolute');
  assert.equal(spread.style.position, 'absolute');
  assert.equal(spread.style.height, '100%');
  assert.equal(spread.style.width, '100%');
  const images = [...h.viewer().querySelectorAll('img')];
  spread.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.equal(toolbar.hidden, true);
  assert.equal(toolbar.style.display, 'none');
  assert.equal(spread.style.height, '100%');
  spread.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
  assert.equal(toolbar.hidden, false);
  assert.deepEqual([...h.viewer().querySelectorAll('img')], images, 'toggling controls must not reload pages');
});

test('toolbar auto-hides and a touch tap shows it without duplicate click toggling', t => {
  const h = harness(t);
  const gestures = gestureTimers(h);
  const original = h.w.setTimeout.bind(h.w);
  let hide;
  h.w.setTimeout = (callback, delay, ...args) => {
    if (delay === 3000) hide = callback;
    return original(callback, delay, ...args);
  };
  h.open();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  const spread = h.viewer().querySelector('[data-toki-spread]');
  hide();
  assert.equal(toolbar.hidden, true);
  assert.equal(h.d.activeElement, spread, 'do not keep focus on a hidden control');
  touch(h, spread, 'touchstart');
  touch(h, spread, 'touchend');
  assert.equal(toolbar.hidden, true, 'wait for the double-tap window');
  gestures.flush(320);
  assert.equal(toolbar.hidden, false);
  spread.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(toolbar.hidden, false);
});

test('swiping turns pages without opening the hidden toolbar', t => {
  const h = harness(t);
  h.open();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  const spread = h.viewer().querySelector('[data-toki-spread]');
  spread.click();
  touch(h, spread, 'touchstart', 20, 50);
  touch(h, spread, 'touchend', 140, 50);
  assert.deepEqual(h.pages(), ['3', '4']);
  assert.equal(toolbar.hidden, true);
});

test('entering fullscreen hides the overlay controls for maximum image area', async t => {
  const h = harness(t);
  fullscreenAPI(h);
  h.open();
  await settle();
  assert.equal(h.viewer().querySelector('[data-toki-toolbar]').hidden, true);
  assert.deepEqual(h.pages(), ['1', '2']);
});

function trackImages(h) {
  const NativeImage = h.w.Image;
  const images = [];
  h.w.Image = function(...args) {
    const image = new NativeImage(...args);
    images.push(image);
    return image;
  };
  return images;
}

function imageSize(image, width, height) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
    complete: { configurable: true, value: true },
  });
}

function sourceSize(h, page, width = 1600, height = 1200) {
  const image = h.d.querySelector(`[data-theme-page="${page}"] img`);
  imageSize(image, width, height);
  return image;
}

test('a combined image owns the full screen width and returns to normal pairs afterwards', t => {
  const h = harness(t, { count: 5 });
  sourceSize(h, 1);
  h.open();
  assert.deepEqual(h.pages(), ['1']);
  assert.equal(h.count(), '1 / 5', 'numbers continue to identify source images');
  const frames = h.viewer().querySelectorAll('[data-toki-page]');
  assert.equal(frames[0].style.width, '100%');
  assert.equal(frames[0].style.flexBasis, '100%');
  assert.equal(frames[1].style.display, 'none', 'a hidden second flex cell must not consume width');
  assert.equal(frames[0].querySelector('img').style.objectPosition, 'center');
  assert.equal(frames[0].querySelector('img').style.objectFit, 'contain');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
  frames.forEach(frame => assert.equal(frame.style.width, '50%'));
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
  assert.equal(h.button('다음 2쪽').disabled, true);
  h.button('이전 2쪽').click();
  h.button('이전 2쪽').click();
  assert.deepEqual(h.pages(), ['1']);
});

for (const ltr of [false, true]) {
  test(`mixed and consecutive combined images preserve every source (LTR: ${ltr})`, t => {
    const h = harness(t, { count: 9 });
    for (const page of [2, 5, 6]) sourceSize(h, page);
    const images = trackImages(h);
    h.open();
    if (ltr) h.button('읽기: 우→좌').click();
    const expected = [['1'], ['2'], ['3', '4'], ['5'], ['6'], ['7', '8'], ['9']];
    for (const pages of expected) {
      assert.deepEqual(h.pages(), pages);
      assert.ok(images.filter(image => image.hasAttribute('src')).length <= 6);
      h.key(ltr ? 'ArrowRight' : 'ArrowLeft');
    }
    assert.equal(h.button('다음 2쪽').disabled, true);
    for (const pages of [...expected].reverse()) {
      assert.deepEqual(h.pages(), pages);
      h.key(ltr ? 'ArrowLeft' : 'ArrowRight');
    }
    assert.equal(h.button('이전 2쪽').disabled, true);
  });
}

test('only natural dimensions at or above 1.2 classify a combined image', t => {
  const h = harness(t, { count: 6 });
  sourceSize(h, 1, 1199, 1000);
  sourceSize(h, 3, 1200, 1000);
  const unknown = h.d.querySelector('[data-theme-page="2"] img');
  unknown.width = 2000;
  unknown.height = 500;
  unknown.style.width = '2000px';
  h.open();
  assert.deepEqual(h.pages(), ['1', '2']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
});

test('lazy placeholder dimensions are ignored until the actual image loads', t => {
  const h = harness(t);
  const source = sourceSize(h, 1, 2000, 500);
  source.dataset.src = source.src;
  source.src = 'https://images.example/placeholder.png';
  h.open();
  assert.deepEqual(h.pages(), ['1', '2']);
  const image = h.viewer().querySelector('img');
  imageSize(image, 800, 1200);
  image.dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('a late combined second image finishes its preceding page without skipping either', t => {
  const h = harness(t);
  h.open();
  const image = h.viewer().querySelectorAll('img')[1];
  imageSize(image, 1600, 1200);
  image.dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['1']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2']);
  assert.equal(h.viewer().querySelector('img'), image, 'reuse the loaded combined image');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  h.button('이전 2쪽').click();
  assert.deepEqual(h.pages(), ['2']);
});

test('a combined prefetch is recognized before the turn and reused at full width', t => {
  const h = harness(t, { count: 8 });
  const images = trackImages(h);
  h.open();
  const image = images[2];
  imageSize(image, 1600, 1200);
  image.dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['1', '2']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3']);
  assert.equal(h.viewer().querySelector('img'), image);
  assert.equal(image.parentElement.style.width, '100%');
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
  assert.ok(images.filter(item => item.hasAttribute('src')).length <= 6);
});

test('late classification in a previous spread keeps the current image visible', t => {
  const h = harness(t, { count: 10 });
  const images = trackImages(h);
  h.open();
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  imageSize(images[0], 1600, 1200);
  images[0].dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['2', '3']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
});

test('late source loads and cover pairing respect combined-image boundaries', t => {
  const h = harness(t, { count: 7 });
  h.open();
  h.button('첫 장 단독').click();
  sourceSize(h, 3).dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['1']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['3']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
  h.button('첫 장 단독').click();
  assert.deepEqual(h.pages(), ['4', '5']);
});

test('each visible image can override detection and that choice survives subsequent loads', t => {
  const h = harness(t);
  const images = trackImages(h);
  h.open();
  pageSettings(h, 2);
  h.button('2쪽 단독 보기').click();
  assert.deepEqual(h.pages(), ['2']);
  assert.equal(h.viewer().querySelector('img').parentElement.style.width, '100%');
  imageSize(images[1], 800, 1200);
  images[1].dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['2'], 'a load must not erase a manual decision');
  pageSettings(h, 2);
  assert.equal(h.button('2쪽 두 쪽에 묶기').getAttribute('aria-pressed'), 'true');
  h.button('2쪽 두 쪽에 묶기').click();
  assert.deepEqual(h.pages(), ['1', '2']);
  imageSize(images[1], 1600, 1200);
  images[1].dispatchEvent(new h.w.Event('load'));
  assert.deepEqual(h.pages(), ['1', '2'], 'manual pairing can suppress a false positive');
  pageSettings(h, 1);
  h.button('1쪽 단독 보기').click();
  assert.deepEqual(h.pages(), ['1']);
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['2', '3']);
});

test('long press opens page settings without floating buttons or an accidental release activation', t => {
  const h = harness(t);
  const timers = gestureTimers(h);
  h.open();
  assert.equal(h.viewer().querySelector('[data-toki-page-mode]'), null);
  assert.equal(h.button('1쪽 단독 보기'), undefined);
  const frame = h.viewer().querySelector('[data-toki-page="1"]');
  const image = frame.querySelector('img');
  touch(h, image, 'touchstart');
  timers.flush(550);
  assert.ok(h.viewer().querySelector('[data-toki-page-popup]'));
  assert.deepEqual(h.pages(), ['1', '2']);
  const mode = h.button('1쪽 단독 보기');
  assert.equal(h.d.activeElement, mode);
  assert.equal(touch(h, image, 'touchend').defaultPrevented, true);
  image.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.ok(h.viewer().querySelector('[data-toki-page-popup]'));
  touch(h, mode, 'touchstart');
  touch(h, mode, 'touchend');
  assert.deepEqual(h.pages(), ['1']);
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  mode.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.deepEqual(h.pages(), ['1'], 'synthetic click after tap must not toggle twice');
  assert.equal(h.d.activeElement, frame);
  timers.flush(320);
  assert.deepEqual(h.pages(), ['1']);
});

test('movement, pinch, cancellation and close cancel pending long presses', t => {
  const h = zoomHarness(t);
  const timers = gestureTimers(h);
  const image = h.viewer().querySelector('img');
  touch(h, image, 'touchstart', 50, 100);
  touch(h, image, 'touchmove', 100, 100);
  timers.flush(550);
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  touch(h, image, 'touchend', 150, 100);
  assert.deepEqual(h.pages(), ['3', '4'], 'swipe still turns pages');
  const current = h.viewer().querySelector('img');
  touch(h, current, 'touchstart');
  h.multiTouch('touchstart', [[1, 20, 20], [2, 200, 20]]);
  timers.flush(550);
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  h.multiTouch('touchend', []);
  touch(h, current, 'touchstart');
  touch(h, current, 'touchcancel');
  timers.flush(550);
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  touch(h, current, 'touchstart');
  h.button('닫기').click();
  timers.flush(550);
  assert.equal(h.viewer(), null);
  assert.equal(timers.size(), 0);
});

test('page popup supports keyboard focus, Escape and backdrop dismissal without navigating', t => {
  const h = harness(t);
  h.open();
  const frame = h.viewer().querySelector('[data-toki-page="2"]');
  frame.focus();
  frame.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(h.d.activeElement, h.button('2쪽 단독 보기'));
  h.key('Tab');
  assert.equal(h.d.activeElement, h.button('취소'));
  h.key('j');
  assert.deepEqual(h.pages(), ['1', '2']);
  h.key('Escape');
  assert.ok(h.viewer());
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  assert.equal(h.d.activeElement, frame);
  pageSettings(h, 2);
  const backdrop = h.viewer().querySelector('[data-toki-popup-backdrop]');
  touch(h, backdrop, 'touchstart');
  touch(h, backdrop, 'touchend');
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('mouse hold works at fit size and a source replacement dismisses a stale popup', async t => {
  const h = harness(t);
  const timers = gestureTimers(h);
  h.open();
  const image = h.viewer().querySelector('img');
  const down = new h.w.MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 50, button: 0 });
  Object.defineProperties(down, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
  image.dispatchEvent(down);
  timers.flush(550);
  const action = h.button('1쪽 단독 보기');
  assert.ok(action);
  putImage(h, 1, 'https://images.example/new-source.webp');
  await settle();
  assert.equal(h.viewer().querySelector('[data-toki-page-popup]'), null);
  action.click();
  assert.deepEqual(h.pages(), ['1', '2']);
});

for (const rtl of [true, false]) {
  test(`40:20:40 touch zones respect direction and chapter boundaries (RTL: ${rtl})`, t => {
    const h = zoomHarness(t);
    const timers = gestureTimers(h);
    if (!rtl) h.button('읽기: 우→좌').click();
    const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
    const tap = x => {
      touch(h, h.spread, 'touchstart', x, 200);
      touch(h, h.spread, 'touchend', x, 200);
      timers.flush(320);
    };
    tap(400);
    assert.equal(toolbar.hidden, true);
    tap(rtl ? 319 : 481);
    assert.deepEqual(h.pages(), ['3', '4']);
    assert.equal(toolbar.hidden, true);
    tap(rtl ? 481 : 319);
    assert.deepEqual(h.pages(), ['1', '2']);
    tap(320);
    assert.equal(toolbar.hidden, false, '40% boundary belongs to center');
    tap(480);
    assert.equal(toolbar.hidden, true, '60% boundary belongs to center');
    tap(rtl ? 700 : 100);
    assert.deepEqual(h.pages(), ['1', '2']);
    assert.equal(toolbar.hidden, false, 'previous beyond the first spread shows menu');
  });
}

test('double tap, pinch and long press consume side taps without an extra page turn', t => {
  const h = zoomHarness(t);
  const timers = gestureTimers(h);
  const tap = () => {
    touch(h, h.spread, 'touchstart', 100, 200);
    touch(h, h.spread, 'touchend', 100, 200);
  };
  tap();
  assert.deepEqual(h.pages(), ['1', '2'], 'side tap waits for a second tap');
  tap();
  timers.flush(320);
  assert.deepEqual(h.pages(), ['1', '2'], 'double tap at 100% must not turn pages');
  h.pinch();
  tap();
  timers.flush(320);
  assert.deepEqual(h.pages(), ['1', '2'], 'side taps cannot turn pages while zoomed');
  tap(); tap();
  timers.flush(320);
  assert.match(h.spread.style.transform, /scale\(1\)/);
  tap();
  h.pinch();
  timers.flush(320);
  assert.deepEqual(h.pages(), ['1', '2'], 'pinch cancels the pending tap');
  const image = h.viewer().querySelector('img');
  touch(h, image, 'touchstart', 100, 200);
  timers.flush(550);
  touch(h, image, 'touchend', 100, 200);
  timers.flush(320);
  assert.ok(h.viewer().querySelector('[data-toki-page-popup]'));
  assert.deepEqual(h.pages(), ['1', '2']);
});

test('replaced image URLs do not inherit combined detection or manual choices', async t => {
  const h = harness(t);
  sourceSize(h, 1);
  h.open();
  pageSettings(h, 1);
  h.button('1쪽 두 쪽에 묶기').click();
  assert.deepEqual(h.pages(), ['1', '2']);
  const source = putImage(h, 1, 'https://images.example/replacement.webp');
  imageSize(source, 1600, 1200);
  await settle();
  assert.deepEqual(h.pages(), ['1'], 'new URL uses its own automatic classification');
  putImage(h, 1, 'https://images.example/replacement-again.webp');
  await settle();
  assert.deepEqual(h.pages(), ['1', '2'], 'an unknown new URL does not inherit a wide classification');
});

test('next spread is prefetched and the same loaded image nodes are displayed on turn', t => {
  const h = harness(t);
  const images = trackImages(h);
  h.open();
  assert.equal(images.length, 4);
  assert.deepEqual(images.map(i => i.src), [1, 2, 3, 4].map(p => `https://images.example/${p}.webp`));
  assert.equal(images[2].isConnected, false);
  assert.equal(images[2].fetchPriority, 'low');
  assert.equal(images[2].referrerPolicy, 'no-referrer');
  images[2].dispatchEvent(new h.w.Event('load'));
  images[3].dispatchEvent(new h.w.Event('load'));
  h.button('다음 2쪽').click();
  const shown = h.viewer().querySelectorAll('img');
  assert.equal(shown[0], images[2]);
  assert.equal(shown[1], images[3]);
  assert.equal(shown[0].fetchPriority, 'high');
  assert.equal(shown[0].parentElement.querySelector('div').style.display, 'none');
  assert.equal(images.length, 6, 'only pages 5 and 6 start new requests');
  h.button('이전 2쪽').click();
  assert.equal(h.viewer().querySelector('img'), images[0]);
  assert.equal(images.length, 6, 'returning to previous spread reuses its images');
});

test('image cache keeps at most previous/current/next spreads and releases on close', t => {
  const h = harness(t, { count: 20 });
  const images = trackImages(h);
  h.open();
  for (let i = 0; i < 7; i++) {
    h.button('다음 2쪽').click();
    assert.ok(images.filter(img => img.hasAttribute('src')).length <= 6);
    assert.equal(h.viewer().querySelectorAll('img').length, 2);
  }
  assert.equal(images[0].hasAttribute('src'), false);
  h.button('닫기').click();
  assert.equal(images.filter(img => img.hasAttribute('src')).length, 0);
  images.forEach(img => img.dispatchEvent(new h.w.Event('load')));
  assert.equal(h.viewer(), null);
});

test('failed prefetch is retried on display while its partner is reused', t => {
  const h = harness(t);
  const images = trackImages(h);
  h.open();
  const failed = images[2];
  const partner = images[3];
  failed.dispatchEvent(new h.w.Event('error'));
  h.button('다음 2쪽').click();
  const shown = h.viewer().querySelectorAll('img');
  assert.notEqual(shown[0], failed);
  assert.equal(shown[0].src, 'https://images.example/3.webp');
  assert.equal(shown[1], partner);
  assert.equal(failed.hasAttribute('src'), false);
});

test('late next-page URLs start prefetch without changing the visible spread', async t => {
  const h = harness(t, { missing: [3] });
  const images = trackImages(h);
  h.open();
  assert.equal(images.length, 3);
  putImage(h, 3);
  await settle();
  assert.equal(images.length, 4);
  assert.deepEqual(h.pages(), ['1', '2']);
  const prefetched = images.at(-1);
  h.button('다음 2쪽').click();
  assert.equal(h.viewer().querySelector('img'), prefetched);
});

test('cover pairing moves cached pages between cells without removing a reused image', t => {
  const h = harness(t, { count: 10 });
  trackImages(h);
  h.open();
  h.button('첫 장 단독').click();
  h.button('다음 2쪽').click();
  h.button('다음 2쪽').click();
  assert.deepEqual(h.pages(), ['4', '5']);
  h.button('첫 장 단독').click();
  assert.deepEqual(h.pages(), ['3', '4']);
  assert.deepEqual([...h.viewer().querySelectorAll('img')].map(i => i.src), [3, 4].map(p => `https://images.example/${p}.webp`));
});

test('chapter navigation clears prefetched image URLs', t => {
  const h = harness(t);
  const images = trackImages(h);
  h.open();
  assert.equal(images.length, 4);
  h.navigate(B);
  assert.equal(images.filter(img => img.hasAttribute('src')).length, 0);
  assert.equal(h.viewer(), null);
});

function episodeLink(h, direction, path) {
  const a = h.d.createElement('a');
  a.className = `theme-viewer-${direction}`;
  a.href = path;
  h.d.body.append(a);
  return a;
}

for (const reuseNodes of [false, true]) {
  test(`episode navigation accepts images updated before metadata and URL (reuse nodes: ${reuseNodes})`, async t => {
    const h = harness(t);
    const next = episodeLink(h, 'next', B);
    let finish;
    next.addEventListener('click', e => {
      e.preventDefault();
      finish = async () => {
        for (const page of [1, 2]) {
          const url = `https://images.example/next${page}.webp`;
          if (reuseNodes) h.d.querySelector(`[data-theme-page="${page}"] img`).src = url;
          else putImage(h, page, url);
        }
        await settle();
        setScope(h, B);
        h.navigate(B);
        await settle();
      };
    });
    h.open();
    h.button('다음화').click();
    await finish();
    assert.ok(h.viewer(), 'navigation resumes the viewer');
    assert.deepEqual([...h.viewer().querySelectorAll('img')].map(img => img.src),
      [1, 2].map(page => `https://images.example/next${page}.webp`));
    h.button('다음 2쪽').click();
    assert.equal(h.viewer().querySelectorAll('img').length, 0, 'unchanged old images remain blocked');
  });
}

test('site episode clicks freeze the latest old sources before its SPA handler runs', async t => {
  const h = harness(t, { navigation: false });
  putImage(h, 3, 'https://images.example/revised-old3.webp');
  await settle();
  episodeLink(h, 'next', B);
  const next = h.d.createElement('a');
  next.href = B;
  next.className = 'btn btn-black';
  next.innerHTML = '<span>다음화</span>';
  h.d.body.append(next);
  let finish;
  next.addEventListener('click', e => {
    e.preventDefault();
    finish = async () => {
      putImage(h, 1, 'https://images.example/next1.webp');
      await settle();
      setScope(h, B);
      h.navigate(B);
      await settle();
    };
  });
  next.querySelector('span').click();
  await finish();
  h.open();
  assert.equal(h.viewer().querySelector('img').src, 'https://images.example/next1.webp');
  h.button('다음 2쪽').click();
  assert.equal(h.viewer().querySelectorAll('img').length, 0);
});

test('Navigation API start freezes ownership until the route commits', async t => {
  const h = harness(t);
  const event = new h.w.Event('navigate');
  Object.defineProperty(event, 'destination', { value: { url: `https://newtoki1.org${B}` } });
  h.w.navigation.dispatchEvent(event);
  putImage(h, 1, 'https://images.example/next1.webp');
  await settle();
  h.w.navigation.dispatchEvent(event);
  setScope(h, B);
  h.navigate(B);
  h.open();
  assert.equal(h.viewer().querySelector('img').src, 'https://images.example/next1.webp');
  assert.equal(h.viewer().querySelectorAll('img').length, 1);
});

test('aborted navigation releases its ownership checkpoint', async t => {
  const h = harness(t);
  const controller = new h.w.AbortController();
  const event = new h.w.Event('navigate');
  Object.defineProperties(event, {
    destination: { value: { url: `https://newtoki1.org${B}` } },
    signal: { value: controller.signal },
  });
  h.w.navigation.dispatchEvent(event);
  controller.abort();
  putImage(h, 1, 'https://images.example/revised-old1.webp');
  await settle();
  h.navigate(B);
  setScope(h, B);
  await settle();
  h.open();
  assert.equal(h.viewer().querySelectorAll('img').length, 0);
});

test('next-episode button navigates once from touch and releases the old images', t => {
  const h = harness(t);
  const a = episodeLink(h, 'next', B);
  let clicks = 0;
  a.addEventListener('click', e => { e.preventDefault(); clicks++; });
  const images = trackImages(h);
  h.open();
  const next = h.button('다음화');
  assert.equal(next.disabled, false);
  touch(h, next, 'touchstart');
  touch(h, next, 'touchend');
  next.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(clicks, 1);
  assert.equal(h.viewer(), null);
  assert.equal(images.filter(i => i.hasAttribute('src')).length, 0);
});

test('missing or disabled next episode never advances the chapter', async t => {
  const h = harness(t);
  h.open();
  assert.equal(h.button('다음화').disabled, true);
  const a = episodeLink(h, 'next', B);
  a.setAttribute('aria-disabled', 'true');
  await settle();
  assert.equal(h.button('다음화').disabled, true);
  a.removeAttribute('aria-disabled');
  await settle();
  assert.equal(h.button('다음화').disabled, false);
});

test('episode controls work on the last spread and preserve direction-independent H/L shortcuts', t => {
  const h = harness(t, { count: 2 });
  const next = episodeLink(h, 'next', B);
  const prev = episodeLink(h, 'prev', '/manhwa/10454/103309');
  const clicked = [];
  next.addEventListener('click', e => { e.preventDefault(); clicked.push('next'); });
  prev.addEventListener('click', e => { e.preventDefault(); clicked.push('prev'); });
  h.open();
  assert.equal(h.button('다음 2쪽').disabled, true);
  assert.equal(h.button('다음화').disabled, false);
  h.key('l');
  assert.deepEqual(clicked, ['next']);
  h.open();
  h.key('h');
  assert.deepEqual(clicked, ['next', 'prev']);
});

test('legacy next-episode buttons are supported', t => {
  const h = harness(t);
  const source = h.d.createElement('button');
  source.id = 'goNextBtn';
  let clicks = 0;
  source.addEventListener('click', () => clicks++);
  h.d.body.append(source);
  h.open();
  h.button('다음화').click();
  assert.equal(clicks, 1);
});

test('next chapter automatically resumes two-page reading once its metadata is current', async t => {
  const h = harness(t);
  const next = episodeLink(h, 'next', B);
  next.addEventListener('click', e => { e.preventDefault(); h.navigate(B); });
  h.open();
  h.button('다음화').click();
  assert.equal(h.viewer(), null, 'wait for matching next-chapter metadata');
  setScope(h, B);
  putImage(h, 1, 'https://images.example/next1.webp');
  putImage(h, 2, 'https://images.example/next2.webp');
  await settle();
  assert.ok(h.viewer());
  assert.deepEqual(h.pages(), ['1', '2']);
  assert.equal(h.viewer().querySelector('img').src, 'https://images.example/next1.webp');
  h.button('닫기').click();
  putImage(h, 3, 'https://images.example/next3.webp');
  await settle();
  assert.equal(h.viewer(), null, 'resume intent is consumed, so closing stays closed');
});


test('keyboard entry also requests fullscreen without a second button press', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  h.key('i');
  assert.equal(fs.calls, 1);
  await settle();
  assert.equal(h.d.fullscreenElement, h.d.documentElement);
});

test('next-episode automatic resume does not request fullscreen without a fresh gesture', async t => {
  const h = harness(t);
  const fs = fullscreenAPI(h);
  const next = episodeLink(h, 'next', B);
  next.addEventListener('click', e => { e.preventDefault(); h.navigate(B); });
  h.open();
  await settle();
  assert.equal(fs.calls, 1);
  h.button('다음화').click();
  setScope(h, B);
  putImage(h, 1, 'https://images.example/new1.webp');
  await settle();
  assert.ok(h.viewer());
  assert.equal(fs.calls, 1, 'automatic resume must not attempt another fullscreen request');
  h.button('전체화면').click();
  await settle();
  assert.equal(fs.calls, 2, 'explicit button remains available after resume');
});

test('swiping past either chapter boundary reveals the menu and stays on that spread', t => {
  const h = harness(t, { count: 5 });
  let episodeClicks = 0;
  const next = episodeLink(h, 'next', B);
  next.addEventListener('click', e => { e.preventDefault(); episodeClicks++; });
  h.open();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  const spread = h.viewer().querySelector('[data-toki-spread]');
  spread.click();
  touch(h, spread, 'touchstart', 140, 50);
  touch(h, spread, 'touchend', 20, 50);
  assert.equal(toolbar.hidden, false);
  assert.deepEqual(h.pages(), ['1', '2']);
  h.button('다음 2쪽').click();
  h.button('다음 2쪽').click();
  spread.click();
  touch(h, spread, 'touchstart', 20, 50);
  touch(h, spread, 'touchend', 140, 50);
  assert.equal(toolbar.hidden, false);
  assert.deepEqual(h.pages(), ['5']);
  spread.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(toolbar.hidden, false, 'the follow-up click must not hide the menu again');
  assert.equal(episodeClicks, 0);
});

test('boundary menu gestures follow LTR direction and cover pairing', t => {
  const h = harness(t, { count: 3 });
  h.open();
  h.button('읽기: 우→좌').click();
  h.button('첫 장 단독').click();
  const toolbar = h.viewer().querySelector('[data-toki-toolbar]');
  const spread = h.viewer().querySelector('[data-toki-spread]');
  spread.click();
  touch(h, spread, 'touchstart', 20, 50);
  touch(h, spread, 'touchend', 140, 50);
  assert.equal(toolbar.hidden, false);
  assert.deepEqual(h.pages(), ['1']);
  h.button('다음 2쪽').click();
  spread.click();
  touch(h, spread, 'touchstart', 140, 50);
  touch(h, spread, 'touchend', 20, 50);
  assert.equal(toolbar.hidden, false);
  assert.deepEqual(h.pages(), ['2', '3']);
});
