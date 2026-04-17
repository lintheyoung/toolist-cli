import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironmentBaseUrl,
  resolveEnvironmentName,
} from '../../../src/lib/environments.js';

describe('CLI environments', () => {
  it('defaults to prod', () => {
    expect(DEFAULT_ENVIRONMENT).toBe('prod');
    expect(resolveEnvironmentBaseUrl('prod')).toBe('https://tooli.st');
  });

  it('maps test and dev explicitly', () => {
    expect(resolveEnvironmentBaseUrl('test')).toBe('https://test.tooli.st');
    expect(resolveEnvironmentBaseUrl('dev')).toBe('http://localhost:3024');
  });

  it('rejects unknown environments', () => {
    expect(() => resolveEnvironmentName('qa')).toThrow(/Unknown environment/);
  });
});
