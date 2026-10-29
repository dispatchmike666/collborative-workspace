// A stand-in for the real `claude` command, used only by the tests.
// It reads the message from stdin and prints the same kind of live output Claude prints.
// Special words in the message change what it does:
//   WRITE:<name>  creates a file called <name> in the current folder
//   ENVCHECK      reports whether ANTHROPIC_API_KEY reached it
//   ARGSCHECK     reports the extra flags it was started with
//   PROMPTCHECK   replies with the whole message it received
//   DENY          finishes with one blocked command listed
//   SLEEP<ms>     waits that long before answering (for example SLEEP800)
//   AUTHFAIL      finishes the way Claude does when its sign-in has expired
//   CRASH         exits with an error
//   HANG          never finishes
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const resumeIndex = args.indexOf('--resume');
const resumeId = resumeIndex >= 0 ? args[resumeIndex + 1] : null;
const sessionId = resumeId ?? 'fake-session-1';

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const assistant = (block) => ({ type: 'assistant', message: { role: 'assistant', content: [block] }, session_id: sessionId });

async function run(prompt) {
  if (prompt.includes('HANG')) {
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt.includes('CRASH')) {
    process.stderr.write('boom: simulated crash');
    process.exitCode = 2;
    return;
  }

  const sleep = prompt.match(/SLEEP(\d+)/);
  if (sleep) await new Promise((resolve) => setTimeout(resolve, Number(sleep[1])));

  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake', apiKeySource: process.env.FAKE_API_KEY_SOURCE ?? 'none' });

  // The last WRITE: wins, because a recap at the top of the message may mention an older one.
  const match = [...prompt.matchAll(/WRITE:(\S+)/g)].at(-1);
  if (match) {
    const file = path.join(process.cwd(), match[1]);
    fs.writeFileSync(file, 'hi');
    out(assistant({ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: file, content: 'hi' } }));
    out({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `File created successfully at: ${file}` }] },
      session_id: sessionId,
    });
  }

  let text = resumeId ? `resumed:${resumeId}` : 'done';
  if (prompt.includes('ENVCHECK')) text = `key:${process.env.ANTHROPIC_API_KEY ?? 'absent'}`;
  if (prompt.includes('ARGSCHECK')) text = `args:${args.join('|')}`;
  if (prompt.includes('PROMPTCHECK')) text = `prompt:${prompt}`;
  const authFail = prompt.includes('AUTHFAIL');
  if (authFail) text = 'Failed to authenticate: OAuth session expired and could not be refreshed';
  out(assistant({ type: 'text', text }));
  const denials = prompt.includes('DENY')
    ? [{ tool_name: 'Bash', tool_use_id: 't9', tool_input: { command: 'curl -s https://example.com', description: 'Check the site' } }]
    : [];
  out({
    type: 'result',
    subtype: 'success',
    is_error: authFail,
    result: text,
    session_id: sessionId,
    duration_ms: 5,
    total_cost_usd: 0,
    permission_denials: denials,
  });
}

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => run(prompt));
