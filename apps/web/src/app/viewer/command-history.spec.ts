import { CommandHistory, type Command } from './command-history';

function command(log: string[], name: string): Command {
  return {
    label: name,
    undo: () => log.push(`undo ${name}`),
    redo: () => log.push(`redo ${name}`),
  };
}

describe('CommandHistory', () => {
  it('keeps only the most recent 100 steps', () => {
    const history = new CommandHistory();
    for (let index = 0; index < 101; index++) history.record(command([], `step ${index}`));

    let undone = 0;
    while (history.undo()) undone++;

    expect(CommandHistory.LIMIT).toBe(100);
    expect(undone).toBe(100);
  });

  it('undoes and redoes in order and drops redo steps when a new change is recorded', () => {
    const log: string[] = [];
    const history = new CommandHistory();
    history.record(command(log, 'a'));
    history.record(command(log, 'b'));

    history.undo();
    history.undo();
    expect(log).toEqual(['undo b', 'undo a']);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(log.at(-1)).toBe('redo a');
    history.undo();
    history.record(command(log, 'c'));

    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
  });
});
