import { element } from './dom';
import { iconButton } from './icons';

export interface ToolbarActions {
  resetView: () => void;
  resetEdits?: () => void;
  expand?: () => void;
  ask?: () => Promise<void>;
}

export class Toolbar {
  readonly element = element('div', 'plot-toolbar');
  private readonly resetEdits: HTMLButtonElement | null;

  constructor(actions: ToolbarActions) {
    this.resetEdits = actions.resetEdits ? iconButton('resetEdits', 'Reset edits', actions.resetEdits) : null;
    const buttons = [iconButton('resetView', 'Reset view', actions.resetView), this.resetEdits];
    if (actions.expand) buttons.push(iconButton('expand', 'Expand', actions.expand));
    const ask = actions.ask;
    if (ask) {
      const button = iconButton('ask', 'Ask about this graph', () => {
        button.disabled = true;
        ask().finally(() => { button.disabled = false; });
      });
      buttons.push(button);
    }
    this.element.append(...buttons.filter(button => button !== null));
    this.setEdited(false);
  }

  setEdited(edited: boolean): void {
    if (this.resetEdits) this.resetEdits.hidden = !edited;
  }
}
