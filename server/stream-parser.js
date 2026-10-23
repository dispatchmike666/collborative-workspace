const MAX_TEXT = 400;

function clip(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fileName(filePath) {
  return String(filePath ?? '').split(/[\\/]/).pop();
}

function blocks(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
  }
  return '';
}

// Commands Claude wanted to run but was not allowed to, in a simple shape for the window.
function listDenials(denials) {
  if (!Array.isArray(denials)) return [];
  return denials.map((denial) => ({
    tool: denial.tool_name,
    id: denial.tool_use_id,
    command: denial.tool_input?.command ?? null,
    description: denial.tool_input?.description ?? null,
  }));
}

// A short human description of what Claude is doing, e.g. "Write hello.txt".
export function summarizeToolUse(name, input = {}) {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name} ${fileName(input.file_path)}`;
    case 'NotebookEdit':
      return `${name} ${fileName(input.notebook_path)}`;
    case 'Bash':
    case 'PowerShell':
      return `${name}: ${clip(input.command, 80)}`;
    case 'Glob':
    case 'Grep':
      return `${name} ${clip(input.pattern, 60)}`;
    default:
      return String(name);
  }
}

// Turns one line of Claude's live output into zero or more events for the window.
export function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'error', text: `Unreadable line from Claude: ${clip(trimmed, 120)}` }];
  }

  if (obj.type === 'system' && obj.subtype === 'init') {
    return [{ kind: 'run-start', sessionId: obj.session_id, model: obj.model, apiKeySource: obj.apiKeySource }];
  }

  if (obj.type === 'assistant') {
    const events = [];
    for (const block of blocks(obj.message)) {
      if (block.type === 'text' && block.text?.trim()) {
        events.push({ kind: 'claude-text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({ kind: 'claude-step', tool: block.name, summary: summarizeToolUse(block.name, block.input) });
      }
    }
    return events;
  }

  if (obj.type === 'user') {
    return blocks(obj.message)
      .filter((block) => block.type === 'tool_result')
      .map((block) => ({ kind: 'claude-step-result', ok: !block.is_error, text: clip(toolResultText(block.content)) }));
  }

  if (obj.type === 'result') {
    return [{
      kind: 'run-done',
      ok: obj.subtype === 'success' && !obj.is_error,
      text: obj.result ?? '',
      sessionId: obj.session_id,
      durationMs: obj.duration_ms,
      costUsd: obj.total_cost_usd,
      denials: listDenials(obj.permission_denials),
    }];
  }

  return [];
}
