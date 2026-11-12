import { DocumentStore, type LoadedDocument, type PlacedElement, type PlacedText } from './document-store';

const center = { x: 300, y: 300 };

function loadedDocument(): LoadedDocument {
  return {
    name: 'test.pdf',
    buffer: new ArrayBuffer(0),
    pdf: {} as LoadedDocument['pdf'],
    pages: [{ width: 612, height: 792 }],
    destroy: async () => undefined,
  };
}

function textOf(store: DocumentStore, id: string): string | undefined {
  const element = store.get(id);
  return element?.kind === 'text' ? element.text : undefined;
}

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
    store.open(loadedDocument());
  });

  function addText(text: string): PlacedText {
    const element = store.createText({ pageIndex: 0, center, text });
    store.addElement(element);
    return element;
  }

  it('undoes and redoes a move as one step', () => {
    const element = addText('Hello');
    store.moveLive(element.id, 0, { x: 100, y: 100 });
    store.recordGesture(element, 'move');

    store.undo();
    expect(store.get(element.id)?.x).toBe(element.x);
    store.redo();
    expect(store.get(element.id)?.x).toBeCloseTo(100 - element.width / 2);
  });

  it('merges repeated nudges of the same step into one undo step', () => {
    const element = addText('Nudge');
    store.nudge(element.id, 1, 0);
    store.nudge(element.id, 1, 0);
    store.nudge(element.id, 1, 0);

    store.undo();
    expect(store.get(element.id)?.x).toBe(element.x);
    expect(store.elements()).toHaveLength(1);
    store.undo();
    expect(store.elements()).toHaveLength(0);
  });

  it('records a new free text element as one step when its first editing session ends', () => {
    const element = store.createText({ pageIndex: 0, center, text: '' });
    store.insertPending(element);
    store.beginTextEdit(element.id, true);
    store.setEditingText('Typed');
    store.endTextEdit();
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(store.elements()).toHaveLength(0);
    store.redo();
    expect(textOf(store, element.id)).toBe('Typed');
  });

  it('removes an empty free text element without an undo step', () => {
    const element = store.createText({ pageIndex: 0, center, text: '' });
    store.insertPending(element);
    store.beginTextEdit(element.id, true);
    store.endTextEdit();

    expect(store.elements()).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
  });

  it('removes a saved text element emptied while editing and restores it on undo', () => {
    const element = addText('Keep me');
    store.beginTextEdit(element.id);
    store.setEditingText('');
    store.endTextEdit();
    expect(store.elements()).toHaveLength(0);

    store.undo();
    expect(store.elements()).toEqual([element]);
  });

  it('duplicates an element with a 10 pt offset and selects the copy', () => {
    const element = addText('Copy');
    store.duplicate(element.id);
    const copy = store.elements()[1] as PlacedElement;

    expect(copy.id).not.toBe(element.id);
    expect(copy.x).toBeCloseTo(element.x + 10);
    expect(copy.y).toBeCloseTo(element.y + 10);
    expect(store.selectedId()).toBe(copy.id);
  });

  it('limits font size changes to 6 to 72 pt', () => {
    const element = addText('Size');

    store.setFontSize(element.id, 200);
    expect(store.get(element.id)).toMatchObject({ fontSize: 72 });
    store.setFontSize(element.id, 1);
    expect(store.get(element.id)).toMatchObject({ fontSize: 6 });
  });
});
