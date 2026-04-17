import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENVIRONMENT,
  inferEnvironmentFromBaseUrl,
  resolveEnvironmentBaseUrl,
  resolveEnvironmentSelection,
  resolveEnvironmentName,
  resolveSelectedProfileBaseUrl,
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

  it('infers canonical environments from their base URLs', () => {
    expect(inferEnvironmentFromBaseUrl('https://tooli.st')).toBe('prod');
    expect(inferEnvironmentFromBaseUrl('https://test.tooli.st')).toBe('test');
    expect(inferEnvironmentFromBaseUrl('http://localhost:3024')).toBe('dev');
  });

  it('does not misclassify unknown base URLs as prod', () => {
    expect(inferEnvironmentFromBaseUrl('https://preview.tooli.st')).toBeNull();
  });

  it('rejects unknown environments', () => {
    expect(() => resolveEnvironmentName('qa')).toThrow(/Unknown environment/);
  });

  it('treats --env and TOOLIST_ENV as explicit hosted selections', () => {
    expect(resolveEnvironmentSelection({
      requestedEnvironment: 'test',
      configuredEnvironment: 'prod',
    })).toEqual({
      environment: 'test',
      isExplicitHostedSelection: true,
    });

    expect(resolveEnvironmentSelection({
      configuredEnvironment: 'prod',
      environmentVariable: 'dev',
    })).toEqual({
      environment: 'dev',
      isExplicitHostedSelection: true,
    });
  });

  it('preserves stored base URLs only for implicit environment selection', () => {
    expect(resolveSelectedProfileBaseUrl({
      environment: 'prod',
      profileBaseUrl: 'https://self-hosted.example.com',
      isExplicitHostedSelection: true,
    })).toBe('https://tooli.st');

    expect(resolveSelectedProfileBaseUrl({
      environment: 'prod',
      profileBaseUrl: 'https://self-hosted.example.com',
      isExplicitHostedSelection: false,
    })).toBe('https://self-hosted.example.com');
  });
});
