// Settings that would make Claude bill per use (an API key, or a cloud provider), or send it somewhere else.
// We remove them before starting Claude, so it can only use the Claude plan login.
const BLOCKED = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_PROFILE',
  'AWS_BEARER_TOKEN_BEDROCK',
]);

// Whole families of settings: every CLAUDE_CODE_USE_<provider> switch (Bedrock, Vertex, Foundry and any
// added later), and the extra settings those cloud providers use.
const BLOCKED_PREFIXES = ['CLAUDE_CODE_USE_', 'ANTHROPIC_BEDROCK_', 'ANTHROPIC_VERTEX_', 'ANTHROPIC_FOUNDRY_'];

export function buildChildEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (BLOCKED.has(name) || BLOCKED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    clean[key] = value;
  }
  return clean;
}
