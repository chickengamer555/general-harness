// Written BEFORE slugify.mjs, run red, then implemented to green.
// The red proof for each of these lives in .general-harness/redproof.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.mjs';

test('slugify handles ordinary input', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Already-Slugged'), 'already-slugged');
});

test('slugify collapses repeated separators', () => {
  assert.equal(slugify('a   b___c//d'), 'a-b-c-d');
  assert.equal(slugify('--leading and trailing--'), 'leading-and-trailing');
});

test('slugify handles empty input', () => {
  // The case that ships broken most often: callers put the result straight
  // into a URL, so undefined here becomes a 404 somewhere far away.
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify('   '), '');
});

test('slugify strips unicode punctuation', () => {
  assert.equal(slugify('café — résumé!'), 'cafe-resume');
  assert.equal(slugify('你好 world'), 'world');
  assert.equal(slugify('100% "real"'), '100-real');
});
