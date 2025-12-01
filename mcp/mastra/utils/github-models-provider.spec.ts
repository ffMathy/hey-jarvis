import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  GEMINI_TO_GITHUB_MODEL_MAP,
  GITHUB_MODELS_DEFAULT_MODEL,
  getEquivalentGitHubModel,
  shouldUseGitHubModels,
} from './github-models-provider';

describe('GitHub Models Provider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('shouldUseGitHubModels', () => {
    it('should return false when not in GitHub Actions', () => {
      delete process.env.GITHUB_ACTIONS;
      process.env.GITHUB_TOKEN = 'test-token';
      expect(shouldUseGitHubModels()).toBe(false);
    });

    it('should return false when no GitHub token is available', () => {
      process.env.GITHUB_ACTIONS = 'true';
      delete process.env.GITHUB_TOKEN;
      delete process.env.HEY_JARVIS_GITHUB_MODELS_TOKEN;
      expect(shouldUseGitHubModels()).toBe(false);
    });

    it('should return true when in GitHub Actions with GITHUB_TOKEN', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_TOKEN = 'test-token';
      expect(shouldUseGitHubModels()).toBe(true);
    });

    it('should return true when in GitHub Actions with HEY_JARVIS_GITHUB_MODELS_TOKEN', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.HEY_JARVIS_GITHUB_MODELS_TOKEN = 'test-token';
      expect(shouldUseGitHubModels()).toBe(true);
    });
  });

  describe('getEquivalentGitHubModel', () => {
    it('should map gemini-flash-latest to gpt-4o-mini', () => {
      expect(getEquivalentGitHubModel('gemini-flash-latest')).toBe('gpt-4o-mini');
    });

    it('should map gemini-pro-latest to gpt-4o', () => {
      expect(getEquivalentGitHubModel('gemini-pro-latest')).toBe('gpt-4o');
    });

    it('should map gemini-flash-lite-latest to gpt-4o-mini', () => {
      expect(getEquivalentGitHubModel('gemini-flash-lite-latest')).toBe('gpt-4o-mini');
    });

    it('should map gemini-2.0-flash-exp to gpt-4o-mini', () => {
      expect(getEquivalentGitHubModel('gemini-2.0-flash-exp')).toBe('gpt-4o-mini');
    });

    it('should return default model for unknown Gemini model', () => {
      expect(getEquivalentGitHubModel('unknown-model')).toBe(GITHUB_MODELS_DEFAULT_MODEL);
    });
  });

  describe('GEMINI_TO_GITHUB_MODEL_MAP', () => {
    it('should have mappings for all common Gemini models', () => {
      const keys = Object.keys(GEMINI_TO_GITHUB_MODEL_MAP);
      expect(keys).toContain('gemini-flash-latest');
      expect(keys).toContain('gemini-pro-latest');
      expect(keys).toContain('gemini-flash-lite-latest');
      expect(keys).toContain('gemini-2.0-flash-exp');
    });
  });

  describe('GITHUB_MODELS_DEFAULT_MODEL', () => {
    it('should be gpt-4o-mini', () => {
      expect(GITHUB_MODELS_DEFAULT_MODEL).toBe('gpt-4o-mini');
    });
  });
});
