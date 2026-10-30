import { spawn } from 'node:child_process';

// Stops a program AND everything it started (commands Claude ran, a dev server, and so on), not only the
// main program. Killing just the main program leaves those behind, still running on the computer.
//
// Windows: `taskkill /T` takes down the whole family of programs, `/F` forces it.
// Mac and Linux: the program was started as the leader of its own group (see `detached` in the runner),
// so signalling the group reaches all of them. Ask politely first, then force it after a moment.
export function killTree(child, { platform = process.platform, spawnImpl = spawn, graceMs = 1500 } = {}) {
  const pid = child?.pid;
  if (!pid) return;

  if (platform === 'win32') {
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
      killer.on('close', (code) => {
        if (code !== 0 && child.exitCode === null) child.kill();
      });
    } catch {
      child.kill();
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const force = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }, graceMs);
  force.unref?.();
  child.once('close', () => clearTimeout(force));
}
