// Settings that would make Claude bill per use (an API key, or a cloud provider).
// We remove them before starting Claude, so it can only use the Claude plan login.
const BLOCKED = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]);

export function buildChildEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (!BLOCKED.has(key.toUpperCase())) clean[key] = value;
  }
  return clean;
}
