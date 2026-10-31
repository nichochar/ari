import { element } from './dom';

export function createEditor(text: string, finish: (text: string | null, keyboard: boolean) => void): HTMLInputElement {
  const input = element('input', 'plot-editor');
  input.type = 'text';
  input.value = text;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Edit expression');
  let done = false;
  const end = (value: string | null, keyboard: boolean) => {
    if (done) return;
    done = true;
    finish(value, keyboard);
  };
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    end(event.key === 'Enter' ? input.value : null, true);
  });
  input.addEventListener('blur', () => end(input.value, false));
  return input;
}
