// The clean example unit: a slug generator.
// SPDX-License-Identifier: MIT
//
// Small on purpose. The interesting part is not the function - it is that the
// contract, the tests and the red proof all existed before it did.

const SEPARATORS = /[\s_/\\-]+/g;
const COMBINING = /[̀-ͯ]/g;
const NON_SLUG = /[^a-z0-9-]+/g;
const REPEATS = /-{2,}/g;

/**
 * Turn arbitrary text into a URL-safe slug.
 *
 * Returns an empty string for nullish or unusable input rather than throwing or
 * returning undefined: callers put this straight into a URL, and "undefined"
 * turning up in a path is a bug that surfaces a long way from here.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function slugify(input) {
  if (input === null || input === undefined) return '';

  return String(input)
    .normalize('NFKD')
    .replace(COMBINING, '')      // strip combining accents, keep the base letter
    .toLowerCase()
    .replace(SEPARATORS, '-')
    .replace(NON_SLUG, '')
    .replace(REPEATS, '-')
    .replace(/^-+|-+$/g, '');
}
