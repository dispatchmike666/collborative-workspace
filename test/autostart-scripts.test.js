// The Windows startup scripts cannot run here (no Windows, no Task Scheduler), so these checks
// guard the choices that matter: hidden start, no time limit, restart, token never saved as
// plain text, and the Glasshouse folder found from the scripts' own location.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const dir = path.join(import.meta.dirname, '..', 'scripts', 'autostart');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const files = ['common.ps1', 'install.ps1', 'uninstall.ps1', 'run-glasshouse.ps1', 'start-hidden.vbs'];

test('every startup script is plain ASCII, which Windows PowerShell 5.1 and wscript read safely', () => {
  for (const name of files) {
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(read(name)), `${name} has a character outside plain ASCII`);
  }
});

test('the folder is found from the scripts\' own location, never a fixed path', () => {
  assert.match(read('common.ps1'), /\$RepoRoot = \(Resolve-Path \(Join-Path \$PSScriptRoot '\.\.\\\.\.'\)\)\.Path/);
  for (const name of files) assert.doesNotMatch(read(name), /[A-Z]:\\Users\\/i, `${name} names a fixed folder`);
});

test('the login task starts everything hidden, with no time limit', () => {
  const install = read('install.ps1');
  assert.match(install, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(install, /-LogonType Interactive/);
  assert.match(install, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(install, /wscript\.exe/);
  const vbs = read('start-hidden.vbs');
  assert.match(vbs, /shell\.Run\(command, 0, True\)/);
  assert.match(vbs, /-WindowStyle Hidden/);
});

test('the runner runs the hub and helper with node and restarts them when they stop', () => {
  const runner = read('run-glasshouse.ps1');
  assert.match(runner, /script = 'hub\\index\.js'/);
  assert.match(runner, /script = 'helper\\index\.js'/);
  assert.match(runner, /HasExited/);
  assert.match(runner, /\$info\.UseShellExecute = \$false/);
  assert.match(runner, /\$info\.CreateNoWindow = \$false/);
  assert.match(runner, /Local\\GlasshouseAutostart/);
});

test('the helper token is saved locked to the Windows account, never as plain text', () => {
  const install = read('install.ps1');
  assert.match(install, /ConvertFrom-SecureString/);
  assert.match(install, /helperToken = \$\(if \(\$runHelper\) \{ \$protectedToken \}/);
  assert.doesNotMatch(install, /helperToken = .*HELPER_TOKEN/);
});

test('no startup script passes risky Claude flags or an API key', () => {
  for (const name of files) {
    const text = read(name);
    assert.doesNotMatch(text, /dangerously-skip-permissions|--bare|ANTHROPIC_API_KEY/, name);
  }
});

test('Windows line endings are kept for the startup scripts', () => {
  const attributes = fs.readFileSync(path.join(import.meta.dirname, '..', '.gitattributes'), 'utf8');
  assert.match(attributes, /\*\.ps1 text eol=crlf/);
  assert.match(attributes, /\*\.vbs text eol=crlf/);
});
