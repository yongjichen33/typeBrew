import { describe, it, expect } from 'vitest';
import { makeInitialState, computeClipboardData, reducer } from './useGlyphEditor';
import { getPoint } from '@/lib/svgPathParser';
import type { EditablePath, Selection, EditorAction } from '@/lib/editorTypes';

describe('makeInitialState', () => {
  it('creates initial state with default values', () => {
    const vt = { scale: 1, originX: 0, originY: 0 };
    const state = makeInitialState(vt);

    expect(state.paths).toEqual([]);
    expect(state.selection.pointIds.size).toBe(0);
    expect(state.selection.segmentIds.size).toBe(0);
    expect(state.toolMode).toBe('node');
    expect(state.viewTransform).toEqual(vt);
    expect(state.isDirty).toBe(false);
    expect(state.isSaving).toBe(false);
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.showDirection).toBe(false);
    expect(state.showCoordinates).toBe(false);
    expect(state.activePathId).toBe(null);
    expect(state.isDrawingPath).toBe(false);
    expect(state.layers).toHaveLength(1);
    expect(state.layers[0].id).toBe('outline');
    expect(state.activeLayerId).toBe('outline');
    expect(state.focusedLayerId).toBe('outline');
    expect(state.showTransformBox).toBe(false);
    expect(state.showPixelGrid).toBe(false);
    expect(state.showPreview).toBe(false);
    expect(state.previewInverted).toBe(false);
    expect(state.previewHeight).toBe(100);
    expect(state.isComposite).toBe(false);
  });

  it('uses provided view transform', () => {
    const vt = { scale: 2.5, originX: 100, originY: 200 };
    const state = makeInitialState(vt);
    expect(state.viewTransform).toEqual(vt);
  });
});

describe('getPoint', () => {
  const makePath = (id: string, commands: EditablePath['commands']): EditablePath => ({
    id,
    commands,
  });

  const makeOnCurvePoint = (id: string, x: number, y: number) => ({
    id,
    x,
    y,
    type: 'on-curve' as const,
  });

  const makeQuadCtrlPoint = (id: string, x: number, y: number) => ({
    id,
    x,
    y,
    type: 'off-curve-quad' as const,
  });

  const makeCubicCtrlPoint = (id: string, x: number, y: number) => ({
    id,
    x,
    y,
    type: 'off-curve-cubic' as const,
  });

  it('returns null for empty paths', () => {
    expect(getPoint([], 'any-id')).toBe(null);
  });

  it('finds M point', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const paths = [makePath('p1', [{ kind: 'M', point: pt }])];
    expect(getPoint(paths, 'm1')).toBe(pt);
  });

  it('finds L point', () => {
    const pt1 = makeOnCurvePoint('m1', 0, 0);
    const pt2 = makeOnCurvePoint('l1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'L', point: pt2 },
      ]),
    ];
    expect(getPoint(paths, 'l1')).toBe(pt2);
  });

  it('finds Q control point', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const ctrl = makeQuadCtrlPoint('qc1', 50, 100);
    const endPt = makeOnCurvePoint('q1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt },
        { kind: 'Q', ctrl, point: endPt },
      ]),
    ];
    expect(getPoint(paths, 'qc1')).toBe(ctrl);
  });

  it('finds Q endpoint', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const ctrl = makeQuadCtrlPoint('qc1', 50, 100);
    const endPt = makeOnCurvePoint('q1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt },
        { kind: 'Q', ctrl, point: endPt },
      ]),
    ];
    expect(getPoint(paths, 'q1')).toBe(endPt);
  });

  it('finds C control points', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const ctrl1 = makeCubicCtrlPoint('c1', 25, 100);
    const ctrl2 = makeCubicCtrlPoint('c2', 75, 100);
    const endPt = makeOnCurvePoint('c3', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt },
        { kind: 'C', ctrl1, ctrl2, point: endPt },
      ]),
    ];
    expect(getPoint(paths, 'c1')).toBe(ctrl1);
    expect(getPoint(paths, 'c2')).toBe(ctrl2);
  });

  it('finds C endpoint', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const ctrl1 = makeCubicCtrlPoint('c1', 25, 100);
    const ctrl2 = makeCubicCtrlPoint('c2', 75, 100);
    const endPt = makeOnCurvePoint('c3', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt },
        { kind: 'C', ctrl1, ctrl2, point: endPt },
      ]),
    ];
    expect(getPoint(paths, 'c3')).toBe(endPt);
  });

  it('returns null for non-existent point', () => {
    const pt = makeOnCurvePoint('m1', 0, 0);
    const paths = [makePath('p1', [{ kind: 'M', point: pt }])];
    expect(getPoint(paths, 'non-existent')).toBe(null);
  });

  it('searches across multiple paths', () => {
    const pt1 = makeOnCurvePoint('m1', 0, 0);
    const pt2 = makeOnCurvePoint('m2', 100, 100);
    const paths = [
      makePath('p1', [{ kind: 'M', point: pt1 }]),
      makePath('p2', [{ kind: 'M', point: pt2 }]),
    ];
    expect(getPoint(paths, 'm2')).toBe(pt2);
  });
});

describe('computeClipboardData', () => {
  const makePath = (id: string, commands: EditablePath['commands']): EditablePath => ({
    id,
    commands,
  });

  const makePoint = (id: string, x: number, y: number) => ({
    id,
    x,
    y,
    type: 'on-curve' as const,
  });

  it('returns empty clipboard for empty selection', () => {
    const paths = [makePath('p1', [{ kind: 'M', point: makePoint('m1', 0, 0) }])];
    const selection: Selection = { pointIds: new Set(), segmentIds: new Set() };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.points).toEqual([]);
    expect(clipboard.segments).toEqual([]);
  });

  it('copies selected points', () => {
    const pt1 = makePoint('m1', 0, 0);
    const pt2 = makePoint('l1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'L', point: pt2 },
      ]),
    ];
    const selection: Selection = { pointIds: new Set(['m1']), segmentIds: new Set() };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.points).toHaveLength(1);
    expect(clipboard.points[0].id).toBe('m1');
    expect(clipboard.points[0].x).toBe(0);
    expect(clipboard.points[0].y).toBe(0);
  });

  it('copies selected segment', () => {
    const pt1 = makePoint('m1', 0, 0);
    const pt2 = makePoint('l1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'L', point: pt2 },
      ]),
    ];
    const selection: Selection = { pointIds: new Set(), segmentIds: new Set(['p1:m1:l1']) };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.segments).toHaveLength(1);
    expect(clipboard.segments[0].kind).toBe('L');
    expect(clipboard.segments[0].startPoint.x).toBe(0);
    expect(clipboard.segments[0].endPoint.x).toBe(100);
  });

  it('copies quadratic segment', () => {
    const pt1 = makePoint('m1', 0, 0);
    const ctrl = { id: 'qc1', x: 50, y: 100, type: 'off-curve-quad' as const };
    const pt2 = makePoint('q1', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'Q', ctrl, point: pt2 },
      ]),
    ];
    const selection: Selection = { pointIds: new Set(), segmentIds: new Set(['p1:m1:q1']) };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.segments).toHaveLength(1);
    expect(clipboard.segments[0].kind).toBe('Q');
    expect(clipboard.segments[0].ctrl1?.x).toBe(50);
  });

  it('copies cubic segment', () => {
    const pt1 = makePoint('m1', 0, 0);
    const ctrl1 = { id: 'c1', x: 25, y: 100, type: 'off-curve-cubic' as const };
    const ctrl2 = { id: 'c2', x: 75, y: 100, type: 'off-curve-cubic' as const };
    const pt2 = makePoint('c3', 100, 0);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'C', ctrl1, ctrl2, point: pt2 },
      ]),
    ];
    const selection: Selection = { pointIds: new Set(), segmentIds: new Set(['p1:m1:c3']) };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.segments).toHaveLength(1);
    expect(clipboard.segments[0].kind).toBe('C');
    expect(clipboard.segments[0].ctrl1?.x).toBe(25);
    expect(clipboard.segments[0].ctrl2?.x).toBe(75);
  });

  it('copies multiple segments', () => {
    const pt1 = makePoint('m1', 0, 0);
    const pt2 = makePoint('l1', 100, 0);
    const pt3 = makePoint('l2', 100, 100);
    const paths = [
      makePath('p1', [
        { kind: 'M', point: pt1 },
        { kind: 'L', point: pt2 },
        { kind: 'L', point: pt3 },
      ]),
    ];
    const selection: Selection = {
      pointIds: new Set(),
      segmentIds: new Set(['p1:m1:l1', 'p1:l1:l2']),
    };
    const clipboard = computeClipboardData(paths, selection);
    expect(clipboard.segments).toHaveLength(2);
  });
});

describe('reducer', () => {
  const makeState = () => makeInitialState({ scale: 1, originX: 0, originY: 0 });

  const makePoint = (id: string, x: number, y: number) => ({
    id,
    x,
    y,
    type: 'on-curve' as const,
  });

  const makePath = (id: string, commands: EditablePath['commands']): EditablePath => ({
    id,
    commands,
  });

  describe('SET_PATHS', () => {
    it('replaces paths and clears selection', () => {
      const state = makeState();
      const paths: EditablePath[] = [makePath('p1', [{ kind: 'M', point: makePoint('m1', 0, 0) }])];
      const action: EditorAction = { type: 'SET_PATHS', paths };
      const newState = reducer(state, action);

      expect(newState.paths).toEqual(paths);
      expect(newState.selection.pointIds.size).toBe(0);
      expect(newState.undoStack).toEqual([]);
      expect(newState.isDirty).toBe(false);
    });
  });

  describe('SET_SELECTION', () => {
    it('sets selection', () => {
      const state = makeState();
      const action: EditorAction = {
        type: 'SET_SELECTION',
        pointIds: new Set(['p1', 'p2']),
        segmentIds: new Set(['s1']),
      };
      const newState = reducer(state, action);

      expect(newState.selection.pointIds.has('p1')).toBe(true);
      expect(newState.selection.pointIds.has('p2')).toBe(true);
      expect(newState.selection.segmentIds.has('s1')).toBe(true);
    });
  });

  describe('TOGGLE_SELECTION', () => {
    it('adds point to selection if not selected', () => {
      const state = makeState();
      const action: EditorAction = { type: 'TOGGLE_SELECTION', pointId: 'p1' };
      const newState = reducer(state, action);

      expect(newState.selection.pointIds.has('p1')).toBe(true);
    });

    it('removes point from selection if already selected', () => {
      const state = makeState();
      state.selection.pointIds.add('p1');
      const action: EditorAction = { type: 'TOGGLE_SELECTION', pointId: 'p1' };
      const newState = reducer(state, action);

      expect(newState.selection.pointIds.has('p1')).toBe(false);
    });
  });

  describe('CLEAR_SELECTION', () => {
    it('clears all selections', () => {
      const state = makeState();
      state.selection.pointIds.add('p1');
      state.selection.segmentIds.add('s1');
      const action: EditorAction = { type: 'CLEAR_SELECTION' };
      const newState = reducer(state, action);

      expect(newState.selection.pointIds.size).toBe(0);
      expect(newState.selection.segmentIds.size).toBe(0);
    });
  });

  describe('SET_TOOL_MODE', () => {
    it('changes tool mode', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_TOOL_MODE', mode: 'pen' };
      const newState = reducer(state, action);

      expect(newState.toolMode).toBe('pen');
    });

    it('clears selection when changing tool', () => {
      const state = makeState();
      state.selection.pointIds.add('p1');
      const action: EditorAction = { type: 'SET_TOOL_MODE', mode: 'pen' };
      const newState = reducer(state, action);

      expect(newState.selection.pointIds.size).toBe(0);
    });
  });

  describe('SET_VIEW_TRANSFORM', () => {
    it('updates view transform', () => {
      const state = makeState();
      const vt = { scale: 2, originX: 100, originY: 200 };
      const action: EditorAction = { type: 'SET_VIEW_TRANSFORM', vt };
      const newState = reducer(state, action);

      expect(newState.viewTransform).toEqual(vt);
    });
  });

  describe('UNDO/REDO', () => {
    it('does nothing with empty undo stack', () => {
      const state = makeState();
      const action: EditorAction = { type: 'UNDO' };
      const newState = reducer(state, action);

      expect(newState.paths).toEqual(state.paths);
    });

    it('undoes after COMMIT_MOVE', () => {
      const state = makeState();
      const paths: EditablePath[] = [
        makePath('p1', [
          { kind: 'M', point: makePoint('m1', 0, 0) },
          { kind: 'L', point: makePoint('l1', 100, 0) },
        ]),
      ];
      state.paths = paths;
      state.selection.pointIds.add('m1');

      // Simulate a move
      const snapshot = {
        paths: [
          makePath('p1', [
            { kind: 'M', point: makePoint('m1', 0, 0) },
            { kind: 'L', point: makePoint('l1', 100, 0) },
          ]),
        ],
      };

      const movedState = reducer(state, { type: 'COMMIT_MOVE', snapshot });
      expect(movedState.undoStack.length).toBe(1);

      // Now undo
      const undoneState = reducer(movedState, { type: 'UNDO' });
      expect(undoneState.undoStack.length).toBe(0);
      expect(undoneState.isDirty).toBe(true);
    });
  });

  describe('MARK_SAVED', () => {
    it('clears dirty flag', () => {
      const state = makeState();
      state.isDirty = true;
      state.isSaving = true;
      const action: EditorAction = { type: 'MARK_SAVED' };
      const newState = reducer(state, action);

      expect(newState.isDirty).toBe(false);
      expect(newState.isSaving).toBe(false);
    });
  });

  describe('SET_SAVING', () => {
    it('sets saving flag', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_SAVING', saving: true };
      const newState = reducer(state, action);

      expect(newState.isSaving).toBe(true);
    });
  });

  describe('SET_SHOW_DIRECTION', () => {
    it('toggles direction display', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_SHOW_DIRECTION', showDirection: true };
      const newState = reducer(state, action);

      expect(newState.showDirection).toBe(true);
    });
  });

  describe('SET_SHOW_PREVIEW', () => {
    it('toggles preview panel', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_SHOW_PREVIEW', showPreview: true };
      const newState = reducer(state, action);

      expect(newState.showPreview).toBe(true);
    });
  });

  describe('SET_PREVIEW_INVERTED', () => {
    it('toggles preview colors', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_PREVIEW_INVERTED', previewInverted: true };
      const newState = reducer(state, action);

      expect(newState.previewInverted).toBe(true);
    });
  });

  describe('SET_PREVIEW_HEIGHT', () => {
    it('sets preview height', () => {
      const state = makeState();
      const action: EditorAction = { type: 'SET_PREVIEW_HEIGHT', previewHeight: 150 };
      const newState = reducer(state, action);

      expect(newState.previewHeight).toBe(150);
    });
  });

  describe('DELETE_SELECTED_POINTS', () => {
    it('does nothing with empty selection', () => {
      const state = makeState();
      state.paths = [makePath('p1', [{ kind: 'M', point: makePoint('m1', 0, 0) }])];
      const action: EditorAction = { type: 'DELETE_SELECTED_POINTS' };
      const newState = reducer(state, action);

      expect(newState.paths).toHaveLength(1);
    });

    it('deletes selected points', () => {
      const state = makeState();
      state.paths = [
        makePath('p1', [
          { kind: 'M', point: makePoint('m1', 0, 0) },
          { kind: 'L', point: makePoint('l1', 100, 0) },
        ]),
      ];
      state.selection.pointIds.add('l1');
      const action: EditorAction = { type: 'DELETE_SELECTED_POINTS' };
      const newState = reducer(state, action);

      expect(newState.paths[0].commands).toHaveLength(1);
      expect(newState.isDirty).toBe(true);
    });
  });
});
