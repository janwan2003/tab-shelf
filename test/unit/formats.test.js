import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, toJSON, toHTML, toText, toMarkdown, findTabGroupsInJSON } from '../../src/formats.js';

const sample = [
  { id: 'a', title: 'Research', createdAt: 1700000000000, starred: true, locked: false,
    tabs: [{ url: 'https://example.com/a?x=1&y=2', title: 'A | with bar <b>' }, { url: 'https://example.org/', title: 'Org', pinned: true }] },
  { id: 'b', title: '', createdAt: 1700000100000, starred: false, locked: true, tabs: [{ url: 'http://localhost:8080/p', title: 'Local "quoted"' }] },
];

test('"URL | title" text with blank-line groups', () => {
  const text = 'https://a.com/1 | First | with bar\nhttps://a.com/2 | Second\n\n\nhttps://b.com | B\nnot a url line\nhttps://c.com\n';
  const r = parseImport(text);
  assert.equal(r.format, 'text');
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0].tabs[0], { url: 'https://a.com/1', title: 'First | with bar' });
  assert.deepEqual(r.groups[1].tabs.map((t) => t.url), ['https://b.com', 'https://c.com']);
  assert.equal(r.groups[1].tabs[1].title, 'https://c.com');
});

test('Windows line endings and BOM', () => {
  const r = parseImport('﻿https://a.com | A\r\nhttps://b.com | B\r\n');
  assert.equal(r.groups[0].tabs.length, 2);
  assert.equal(r.groups[0].tabs[1].title, 'B');
});

test('Tabhaven JSON round trip keeps ids, flags and titles', () => {
  const r = parseImport(toJSON(sample));
  assert.equal(r.format, 'tabhaven');
  assert.deepEqual(r.groups.map((g) => g.id), ['a', 'b']);
  assert.equal(r.groups[0].starred, true);
  assert.equal(r.groups[1].locked, true);
  assert.equal(r.groups[0].tabs[0].title, 'A | with bar <b>');
  assert.equal(r.groups[0].tabs[1].pinned, true);
});

test('Tabhaven HTML backup is importable and escapes markup', () => {
  const html = toHTML(sample);
  assert.ok(!html.includes('with bar <b>') && html.includes('with bar &lt;b&gt;'), 'title markup must be escaped');
  const r = parseImport(html);
  assert.equal(r.format, 'tabhaven-html');
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].tabs[0].url, 'https://example.com/a?x=1&y=2');
});

test('script-closing text in titles cannot break the HTML backup', () => {
  const evil = [{ id: 'x', title: '</script><script>alert(1)</script>', createdAt: 1, tabs: [{ url: 'https://e.com', title: '</script>' }] }];
  const r = parseImport(toHTML(evil));
  assert.equal(r.groups[0].title, '</script><script>alert(1)</script>');
});

test('text export round trip', () => {
  const r = parseImport(toText(sample));
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].tabs[0].title, 'A | with bar <b>');
});

test('markdown export round trip', () => {
  const r = parseImport(toMarkdown(sample));
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].title, 'Research');
  assert.equal(r.groups[0].tabs[1].url, 'https://example.org/');
});

test('generic JSON: sessions > windows > tabs arrays', () => {
  const data = { sessions: [{ name: 'Work', created: '2024-03-01T10:00:00Z', windows: [
    { tabs: [{ url: 'https://w1.com', title: 'W1' }, { url: 'https://w2.com', title: 'W2' }] },
    { tabs: [{ url: 'https://w3.com', title: 'W3' }] }] }] };
  const r = parseImport(JSON.stringify(data));
  assert.equal(r.format, 'json');
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].title, 'Work');
  assert.equal(r.groups[0].createdAt, Date.parse('2024-03-01T10:00:00Z'));
});

test('generic JSON: objects keyed by id (window -> tab maps)', () => {
  const data = [{ name: 'S1', windows: { 1: { 11: { url: 'https://a.com', title: 'A' }, 12: { url: 'https://b.com', title: 'B' } } } }];
  const g = findTabGroupsInJSON(data);
  assert.equal(g.length, 1);
  assert.equal(g[0].tabs.length, 2);
  assert.equal(g[0].title, 'S1');
});

test('generic JSON: lists of cards', () => {
  const data = { lists: [{ title: 'Reading', cards: [{ title: 'X', url: 'https://x.com' }] }, { title: 'Empty', cards: [] }] };
  const g = findTabGroupsInJSON(data);
  assert.deepEqual(g.map((x) => x.title), ['Reading']);
});

test('bookmarks-style HTML with headings', () => {
  const html = '<DL><DT><H3>Folder &amp; One</H3><DL><DT><A HREF="https://a.com/?q=1&amp;r=2">A &amp; B</A><DT><A HREF="javascript:void(0)">bad</A></DL><DT><H3>Two</H3><DL><DT><A HREF="https://b.com">B</A></DL></DL>';
  const r = parseImport(html);
  assert.equal(r.format, 'html');
  assert.deepEqual(r.groups.map((g) => g.title), ['Folder & One', 'Two']);
  assert.equal(r.groups[0].tabs[0].url, 'https://a.com/?q=1&r=2');
  assert.equal(r.groups[0].tabs.length, 1);
});

test('empty and junk input yields no groups', () => {
  assert.equal(parseImport('').groups.length, 0);
  assert.equal(parseImport('hello world\nfoo bar').groups.length, 0);
  assert.equal(parseImport('{"a": 1}').groups.length, 0);
});

test('5,000-tab text import parses quickly', () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `https://example.com/page/${i} | Page ${i}`).join('\n');
  const t0 = performance.now();
  const r = parseImport(lines);
  assert.equal(r.groups[0].tabs.length, 5000);
  assert.ok(performance.now() - t0 < 500);
});
