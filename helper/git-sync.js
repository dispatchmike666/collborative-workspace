import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runGit(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const lastLines = (text) => text.trim().split('\n').slice(-3).join(' ');

// Keeps this computer's copy of a project in step with GitHub, using plain git commands.
// Commands are always run with an argument list, never through a shell.
export class GitSync {
  #command;
  #config;
  #timeoutMs;
  #env;

  constructor({ gitCommand = 'git', configOverrides = [], timeoutMs = 120_000, env = process.env } = {}) {
    this.#command = gitCommand;
    this.#config = configOverrides.flatMap((setting) => ['-c', setting]);
    this.#timeoutMs = timeoutMs;
    // Never wait for someone to type a password or click a login window. Fail with a message instead.
    this.#env = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  }

  async #git(args, { cwd, check = true } = {}) {
    let result;
    try {
      result = await runGit(this.#command, [...this.#config, ...args], { cwd, env: this.#env, timeoutMs: this.#timeoutMs });
    } catch (error) {
      throw new Error(`Couldn't run git: ${error.message}. Is Git installed on this computer?`);
    }
    if (check && result.code !== 0) {
      throw new Error(`git ${args[0]} failed: ${lastLines(result.stderr || result.stdout)}`);
    }
    return result;
  }

  async #hasCommits(cwd) {
    return (await this.#git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, check: false })).code === 0;
  }

  async #branch(cwd) {
    return (await this.#git(['symbolic-ref', '--short', 'HEAD'], { cwd })).stdout.trim();
  }

  async #identityArgs(cwd, who) {
    const email = (await this.#git(['config', 'user.email'], { cwd, check: false })).stdout.trim();
    return email ? [] : ['-c', `user.name=${who}'s Claude`, '-c', 'user.email=claude@glasshouse.local'];
  }

  // Gets this computer's copy ready before Claude works: copy the project the first time,
  // and bring in whatever the other computer saved since last time.
  async prepare({ projectDir, repoUrl }) {
    const hasGit = fs.existsSync(path.join(projectDir, '.git'));

    if (!repoUrl) {
      fs.mkdirSync(projectDir, { recursive: true });
      if (!hasGit) await this.#git(['init'], { cwd: projectDir });
      return { mode: 'local' };
    }

    if (!hasGit) {
      if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
        throw new Error(`The folder ${projectDir} is not a copy of the project, so I left it alone.`);
      }
      fs.mkdirSync(path.dirname(projectDir), { recursive: true });
      try {
        await this.#git(['clone', '--', repoUrl, projectDir], { cwd: path.dirname(projectDir) });
      } catch (error) {
        throw new Error(`Couldn't get the project files from ${repoUrl}. Check that this computer's saved GitHub login can open it. (${error.message})`);
      }
      return { mode: 'shared', cloned: true, empty: !(await this.#hasCommits(projectDir)) };
    }

    try {
      await this.#git(['fetch', 'origin'], { cwd: projectDir });
    } catch (error) {
      throw new Error(`Couldn't reach GitHub to get the latest files. (${error.message})`);
    }
    const branch = await this.#branch(projectDir);
    const remoteHasBranch = (await this.#git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: projectDir, check: false })).code === 0;
    if (!remoteHasBranch) return { mode: 'shared', empty: true };

    try {
      if (await this.#hasCommits(projectDir)) await this.#git(['merge', '--ff-only', `origin/${branch}`], { cwd: projectDir });
      else await this.#git(['checkout', '-B', branch, `origin/${branch}`], { cwd: projectDir });
    } catch (error) {
      throw new Error(`This computer's copy and GitHub have gone different ways, so the latest files could not be brought in. Ask for help sorting it out. (${error.message})`);
    }
    return { mode: 'shared', pulled: true };
  }

  // Saves what Claude changed: commit it, and for shared projects push it to GitHub.
  async finish({ projectDir, repoUrl, message, who }) {
    await this.#git(['add', '-A'], { cwd: projectDir });
    const staged = (await this.#git(['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only'], { cwd: projectDir }))
      .stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const identity = await this.#identityArgs(projectDir, who);

    let committed = false;
    if (staged.length) {
      await this.#git([...identity, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', message], { cwd: projectDir });
      committed = true;
    }
    if (!repoUrl || !(await this.#hasCommits(projectDir))) return { changed: staged, committed, pushed: false };

    const pushed = await this.#push(projectDir, identity);
    return { changed: staged, committed, pushed };
  }

  async #push(cwd, identity) {
    let result = await this.#git(['push', '-u', 'origin', 'HEAD'], { cwd, check: false });
    if (result.code !== 0) {
      // Usually the other computer saved first. Put our changes on top of theirs and try once more.
      const branch = await this.#branch(cwd);
      await this.#git(['fetch', 'origin'], { cwd, check: false });
      const rebase = await this.#git([...identity, 'rebase', `origin/${branch}`], { cwd, check: false });
      if (rebase.code !== 0) {
        await this.#git(['rebase', '--abort'], { cwd, check: false });
        throw new Error('Both computers changed the same part of a file, so the changes could not be combined automatically. Nothing was lost. Ask for help sorting it out.');
      }
      result = await this.#git(['push', '-u', 'origin', 'HEAD'], { cwd, check: false });
      if (result.code !== 0) throw new Error(`Couldn't save to GitHub: ${lastLines(result.stderr || result.stdout)}`);
    }
    return !/Everything up-to-date/i.test(`${result.stderr}${result.stdout}`);
  }
}
