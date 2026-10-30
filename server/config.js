import fs from 'node:fs';
import path from 'node:path';

// How we start Claude for each message. Every flag here is on purpose:
//  -p + stream-json + --verbose   run once and print each step as it happens
//  --permission-mode acceptEdits  Claude may create and edit files without asking
//  --setting-sources ""           read NO settings files at all, not even the project's own. A shared
//                                 project can carry a settings file that runs commands before every
//                                 message, changes Claude's environment (for example where it sends
//                                 requests) and widens what it may do without asking. With no setting
//                                 sources none of that runs. The project's CLAUDE.md instructions still
//                                 load. Checked with the real Claude: test/acceptance/hostile-project.manual.mjs
//  --disable-slash-commands       turn off skills
//  --strict-mcp-config            ignore other connected tools
// Never add --bare (it skips the Claude plan login and only works with an API key) or
// --dangerously-skip-permissions.
export const CLAUDE_ARGS = [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-mode', 'acceptEdits',
  '--setting-sources', '',
  '--disable-slash-commands',
  '--strict-mcp-config',
];

// On Windows the `claude` command is a small wrapper that Node cannot start directly,
// so we point at the real claude.exe that npm installs next to it.
export function resolveClaudeCommand(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (platform === 'win32' && env.APPDATA) {
    const exe = path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (exists(exe)) return exe;
  }
  return 'claude';
}

export function loadConfig({ root, env = process.env }) {
  return {
    port: Number(env.PORT ?? 3000),
    projectDir: path.resolve(env.PROJECT_DIR ?? path.join(root, 'workspace-data', 'demo')),
    userName: env.WORKSPACE_USER ?? 'Brennan',
    claudeCommand: resolveClaudeCommand(env),
    claudeArgs: CLAUDE_ARGS,
  };
}
