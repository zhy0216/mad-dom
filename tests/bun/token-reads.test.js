import { afterEach, expect, test } from 'bun:test';
import { Window } from '../../index.js';
import { hasMaterializedNodeHandle } from '../../js/facade/extensions/classes.js';
const windows = [];
function fresh() { const window = new Window(); windows.push(window); return window; }
afterEach(() => { for (const window of windows.splice(0)) window.destroy(); });

test('matches, text and live child reads preserve lazy wrappers and reflect mutations', () => {
  const { document } = fresh();
  document.body.innerHTML = '<p class="note">One<span>Two</span><!--three--></p>';
  const paragraph = document.body.querySelectorAll('p')[0];
  expect(paragraph.matches('p.note')).toBe(true);
  expect(paragraph.textContent).toBe('OneTwo');
  const children = paragraph.childNodes;
  expect(children).toBe(paragraph.childNodes);
  expect(children.length).toBe(3);
  const text = children[0];
  expect(text.textContent).toBe('One');
  expect(Array.from(children, node => node.textContent)).toEqual(['One', 'Two', 'three']);
  for (const node of [paragraph, ...children]) expect(hasMaterializedNodeHandle(node)).toBe(false);
  paragraph.className = 'changed';
  text.textContent = 'Updated';
  expect(paragraph.matches('p.note')).toBe(false);
  expect(paragraph.textContent).toBe('UpdatedTwo');
  paragraph.replaceChildren('Last');
  expect(children.length).toBe(1);
  expect(children[0].textContent).toBe('Last');
  expect(text.textContent).toBe('Updated');
});

test('typed selector rejection preserves full grammar, namespaces, errors and destruction', () => {
  const window = fresh();
  const { document } = window;
  document.body.innerHTML = '<div data-note="a,b > c" data-x="y"><span></span></div><svg><a></a></svg>';
  const div = document.body.querySelectorAll('div')[0];
  const span = document.body.querySelectorAll('span')[0];
  for (const selector of ['div', 'DIV', 'div[data-note="a,b > c"]', 'div:not([missing])']) {
    expect(div.matches(selector)).toBe(true);
    expect(span.matches(selector)).toBe(false);
  }
  for (const selector of ['div > span', 'div span', 'div,span']) {
    expect(span.matches(selector)).toBe(true);
    expect(span.matches(selector)).toBe(true);
  }
  for (const selector of ['div[', 'div:unsupported', 'div:not([x])garbage']) {
    expect(() => span.matches(selector)).toThrow();
    expect(() => span.matches(selector)).toThrow();
  }
  const foreign = document.querySelector('svg|a');
  expect(div.matches('a')).toBe(false);
  expect(foreign.matches('a')).toBe(false);
  expect(foreign.matches('svg|a')).toBe(true);
  const children = div.childNodes;
  window.destroy();
  expect(() => span.matches('div')).toThrow();
  expect(() => span.matches('span')).toThrow();
  expect(() => div.textContent).toThrow();
  expect(() => children.length).toThrow();
  expect(() => Array.from(children)).toThrow();
});
