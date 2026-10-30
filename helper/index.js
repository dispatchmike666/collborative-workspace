import os from 'node:os';
import path from 'node:path';
import { CLAUDE_ARGS, resolveClaudeCommand } from '../server/config.js';
import { Helper } from './helper.js';
import { ChatWatcher } from './live-chats.js';

const hubUrl = process.env.HUB_URL;
const token = process.env.HELPER_TOKEN;

if (!hubUrl || !token) {
  console.error('The helper needs two things before it can start:');
  console.error('  HUB_URL       the address of the workspace, for example http://localhost:3000');
  console.error('  HELPER_TOKEN  your own helper token (from your private credentials file)');
  console.error('See docs/max-setup.md for the steps.');
  process.exit(1);
}

const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? path.join(os.homedir(), 'shared-workspace-projects'));
const stamp = () => new Date().toLocaleTimeString();

const helper = new Helper({
  hubUrl,
  token,
  workspaceRoot,
  claudeCommand: resolveClaudeCommand(),
  claudeArgs: CLAUDE_ARGS,
  // Set SHOW_OPEN_CHATS=off to keep your open Claude chats out of the workspace page.
  liveChats: process.env.SHOW_OPEN_CHATS === 'off' ? null : new ChatWatcher(),
  log: (message) => console.log(`[${stamp()}] ${message}`),
  onFatal: () => process.exit(1),
});

console.log('Your helper is starting.');
console.log(`It connects to: ${hubUrl}`);
console.log(`Project files are kept in: ${workspaceRoot}`);
console.log('It runs your own Claude, signed in with your own Claude plan. Press Ctrl+C to stop.');
helper.start();

process.on('SIGINT', () => {
  helper.stop();
  process.exit(0);
});
