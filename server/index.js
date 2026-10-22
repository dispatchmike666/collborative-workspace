import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ClaudeRunner } from './claude-runner.js';
import { loadConfig } from './config.js';
import { createApp } from './http-app.js';
import { Timeline } from './timeline.js';

const root = path.resolve(import.meta.dirname, '..');
const config = loadConfig({ root });
fs.mkdirSync(config.projectDir, { recursive: true });

const timeline = new Timeline();
const runner = new ClaudeRunner({
  command: config.claudeCommand,
  baseArgs: config.claudeArgs,
  cwd: config.projectDir,
  onEvent: (event) => timeline.add(event),
});
const app = createApp({
  timeline,
  runner,
  publicDir: path.join(root, 'public'),
  userName: config.userName,
});

// 127.0.0.1 means "this computer only": nothing else on the network can reach it.
http.createServer(app).listen(config.port, '127.0.0.1', () => {
  console.log(`Shared workspace is running at http://localhost:${config.port}`);
  console.log(`Claude works in this folder: ${config.projectDir}`);
  console.log('Press Ctrl+C to stop.');
});
