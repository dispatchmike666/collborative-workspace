import { filterCommands } from './logic.js';
import { el } from './ui.js';

// The Ctrl+K box: type a few letters, pick what you want, press Enter.
// getCommands() returns [{ label, icon, hint, run }] and is asked again every time the box opens.
export function createPalette(getCommands) {
  let dialog = null;

  function open() {
    if (dialog) return;
    const commands = getCommands();
    let results = commands;
    let active = 0;
    const input = el('input', { type: 'text', placeholder: 'Type to jump somewhere or do something…', 'aria-label': 'Command', autocomplete: 'off' });
    const list = el('ul', { class: 'palette-list', role: 'listbox' });

    function close() {
      dialog?.close();
    }
    function run(command) {
      close();
      command.run();
    }
    function render() {
      results = filterCommands(commands, input.value);
      active = Math.min(active, Math.max(0, results.length - 1));
      list.replaceChildren(...(results.length
        ? results.map((command, index) => el(
          'li',
          {
            role: 'option',
            'aria-selected': String(index === active),
            onclick: () => run(command),
            onmousemove: () => {
              if (active !== index) {
                active = index;
                render();
              }
            },
          },
          el('span', { text: command.icon ?? '›' }),
          el('span', { text: command.label }),
          command.hint ? el('span', { class: 'hint', text: command.hint }) : null,
        ))
        : [el('li', { class: 'muted', text: 'Nothing matches. Try another word.' })]));
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => {
      active = 0;
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = Math.min(active + 1, results.length - 1);
        render();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (results[active]) run(results[active]);
      }
    });

    dialog = el(
      'dialog',
      { 'aria-label': 'Command palette' },
      el(
        'div',
        { class: 'palette-box' },
        input,
        list,
        el('div', { class: 'palette-foot' },
          el('span', {}, el('kbd', { text: '↑ ↓' }), ' choose'),
          el('span', {}, el('kbd', { text: 'Enter' }), ' go'),
          el('span', {}, el('kbd', { text: 'Esc' }), ' close')),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      dialog = null;
    });
    document.body.append(dialog);
    dialog.showModal();
    render();
    input.focus();
  }

  return { open };
}
