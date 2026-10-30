import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChildEnv } from '../server/child-env.js';

test('removes every setting that could make Claude bill per use', () => {
  const clean = buildChildEnv({
    PATH: '/bin',
    anthropic_api_key: 'x',
    ANTHROPIC_AUTH_TOKEN: 'y',
    ANTHROPIC_BASE_URL: 'z',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_FOUNDRY: '1',
    HOME: '/home/me',
  });
  assert.deepEqual(clean, { PATH: '/bin', HOME: '/home/me' });
});

test('removes whole families of provider settings, including ones added later', () => {
  const clean = buildChildEnv({
    PATH: '/bin',
    CLAUDE_CODE_USE_MANTLE: '1',
    claude_code_use_something_new: '1',
    ANTHROPIC_BEDROCK_BASE_URL: 'a',
    ANTHROPIC_VERTEX_PROJECT_ID: 'b',
    ANTHROPIC_FOUNDRY_API_KEY: 'c',
    ANTHROPIC_PROFILE: 'd',
    AWS_BEARER_TOKEN_BEDROCK: 'e',
  });
  assert.deepEqual(clean, { PATH: '/bin' });
});

test('keeps ordinary settings that merely look similar', () => {
  const env = { ANTHROPIC_MODEL: 'sonnet', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_OAUTH_TOKEN: 't', AWS_REGION: 'us-east-1' };
  assert.deepEqual(buildChildEnv(env), env);
});

test('keeps the Claude plan login token', () => {
  const clean = buildChildEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'plan-token' });
  assert.deepEqual(clean, { CLAUDE_CODE_OAUTH_TOKEN: 'plan-token' });
});

test('does not change the object it was given', () => {
  const original = { ANTHROPIC_API_KEY: 'x', PATH: '/bin' };
  buildChildEnv(original);
  assert.deepEqual(original, { ANTHROPIC_API_KEY: 'x', PATH: '/bin' });
});
