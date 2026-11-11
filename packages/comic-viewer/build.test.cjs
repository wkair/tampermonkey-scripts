const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const metadata = require('./userscript.json');
const script = fs.readFileSync(`${__dirname}/dist/comic-viewer.user.js`, 'utf8');

test('built userscript keeps installation metadata and needs no external runtime', () => {
  assert.ok(script.startsWith('// ==UserScript=='));
  const header = script.slice(0, script.indexOf('// ==/UserScript=='));
  for (const [key, value] of Object.entries(metadata)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const line = header.split('\n').find(line => line.match(new RegExp(`^// @${key}\\s*(.*)$`))?.[1].trim() === (item === true ? '' : item));
      assert.ok(line, `Missing metadata: ${key} ${item}`);
    }
  }
  assert.doesNotMatch(header, /@require|@resource/);
  assert.match(script, new RegExp(`const VERSION = ["']${metadata.version}["']`));
});

test('built userscript opens two pages, advances, and closes', t => {
  const dom = new JSDOM('<div class="theme-viewer-nav"></div><div data-theme-viewer-images></div>', {
    url: 'https://newtoki1.org/manhwa/10454/103310',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  t.after(async () => {
    window.dispatchEvent(new window.Event('pagehide'));
    await new Promise(resolve => setImmediate(resolve));
    window.close();
  });
  const document = window.document;
  const area = document.querySelector('[data-theme-viewer-images]');
  for (let page = 1; page <= 4; page++) {
    area.insertAdjacentHTML('beforeend', `<div data-theme-page="${page}"><img src="https://images.example/${page}.webp"></div>`);
  }
  window.eval(script);
  const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text);
  button('두 쪽 보기').click();
  assert.ok(document.querySelector('[data-toki-spread-viewer]'));
  assert.equal(document.querySelector('[data-toki-page-count]').textContent, '1–2 / 4');
  button('다음 2쪽').click();
  assert.equal(document.querySelector('[data-toki-page-count]').textContent, '3–4 / 4');
  button('닫기').click();
  assert.equal(document.querySelector('[data-toki-spread-viewer]'), null);
});
