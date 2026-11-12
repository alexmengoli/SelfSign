export interface Command {
  readonly label: string;
  undo(): void;
  redo(): void;
}

/** Undo/redo stack that keeps the most recent steps and drops redo steps on each new change. */
export class CommandHistory {
  static readonly LIMIT = 100;

  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get top(): Command | undefined {
    return this.undoStack.at(-1);
  }

  /** Records a command whose change has already been applied. */
  record(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > CommandHistory.LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.redo();
    this.undoStack.push(command);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
