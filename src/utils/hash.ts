import { createHash } from 'node:crypto';

export function sha256Hex(input: string): `0x${string}` {
  return `0x${createHash('sha256').update(input).digest('hex')}`;
}

export type HashedArtifact = {
  algorithm: 'sha256';
  encoding: 'canonical-json';
  hash: `0x${string}`;
  canonicalJson: string;
  byteLength: number;
};

export function hashCanonicalJson(value: unknown): HashedArtifact {
  const canonicalJson = canonicalStringify(value);
  return {
    algorithm: 'sha256',
    encoding: 'canonical-json',
    hash: sha256Hex(canonicalJson),
    canonicalJson,
    byteLength: Buffer.byteLength(canonicalJson, 'utf8'),
  };
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      const entry = record[key];
      if (entry !== undefined) accumulator[key] = canonicalize(entry);
      return accumulator;
    }, {});
}
