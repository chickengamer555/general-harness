// Stable SHA-256 over a contract, so "locked" is provable rather than asserted.
// SPDX-License-Identifier: MIT
//
// Locking a task contract records this hash. Later stages recompute it before
// trusting the contract, which makes "we agreed this" provable rather than
// asserted — and makes a goalpost quietly moved mid-run immediately visible.
import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted, arrays order-preserved. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

/** Fields that legitimately change without changing the agreement. */
const VOLATILE = new Set(['$schema', 'canonicalHash', 'lockedAt', 'notes']);

export function canonicalHash(contract) {
  const stripped = {};
  for (const [k, v] of Object.entries(contract)) if (!VOLATILE.has(k)) stripped[k] = v;
  return createHash('sha256').update(canonicalize(stripped), 'utf8').digest('hex');
}
