import { useReducer } from 'react';
import type {
  EditorAction,
  EditorState,
  EditablePath,
  EditablePoint,
  ViewTransform,
} from '@/lib/editorTypes';
import { clonePaths } from '@/lib/svgPathParser';

const MAX_UNDO = 50;

function applyPointDelta(
  paths: EditablePath[],
  deltas: Map<string, { x: number; y: number }>,
): EditablePath[] {
  return paths.map((path) => ({
    ...path,
    commands: path.commands.map((cmd) => {
      if (cmd.kind === 'M' || cmd.kind === 'L') {
        const d = deltas.get(cmd.point.id);
        if (!d) return cmd;
        return { ...cmd, point: { ...cmd.point, x: cmd.point.x + d.x, y: cmd.point.y + d.y } };
      }
      if (cmd.kind === 'Q') {
        const dc = deltas.get(cmd.ctrl.id);
        const dp = deltas.get(cmd.point.id);
        return {
          ...cmd,
          ctrl: dc ? { ...cmd.ctrl, x: cmd.ctrl.x + dc.x, y: cmd.ctrl.y + dc.y } : cmd.ctrl,
          point: dp ? { ...cmd.point, x: cmd.point.x + dp.x, y: cmd.point.y + dp.y } : cmd.point,
        };
      }
      if (cmd.kind === 'C') {
        const d1 = deltas.get(cmd.ctrl1.id);
        const d2 = deltas.get(cmd.ctrl2.id);
        const dp = deltas.get(cmd.point.id);
        return {
          ...cmd,
          ctrl1: d1 ? { ...cmd.ctrl1, x: cmd.ctrl1.x + d1.x, y: cmd.ctrl1.y + d1.y } : cmd.ctrl1,
          ctrl2: d2 ? { ...cmd.ctrl2, x: cmd.ctrl2.x + d2.x, y: cmd.ctrl2.y + d2.y } : cmd.ctrl2,
          point: dp ? { ...cmd.point, x: cmd.point.x + dp.x, y: cmd.point.y + dp.y } : cmd.point,
        };
      }
      return cmd;
    }),
  }));
}

function getPoint(paths: EditablePath[], id: string): EditablePoint | null {
  for (const path of paths) {
    for (const cmd of path.commands) {
      if ((cmd.kind === 'M' || cmd.kind === 'L') && cmd.point.id === id) return cmd.point;
      if (cmd.kind === 'Q') {
        if (cmd.ctrl.id === id) return cmd.ctrl;
        if (cmd.point.id === id) return cmd.point;
      }
      if (cmd.kind === 'C') {
        if (cmd.ctrl1.id === id) return cmd.ctrl1;
        if (cmd.ctrl2.id === id) return cmd.ctrl2;
        if (cmd.point.id === id) return cmd.point;
      }
    }
  }
  return null;
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_PATHS': {
      return {
        ...state,
        paths: action.paths,
        selection: { pointIds: new Set(), segmentIds: new Set() },
        undoStack: [],
        redoStack: [],
        isDirty: false,
      };
    }

    case 'MOVE_POINTS_LIVE': {
      // In-flight update during drag — update paths only, no undo entry
      return { ...state, paths: applyPointDelta(state.paths, action.deltas), isDirty: true };
    }

    case 'COMMIT_MOVE': {
      // Drag finished — push the pre-drag snapshot as a single undo entry
      const undoStack = [...state.undoStack.slice(-MAX_UNDO + 1), action.snapshot];
      return { ...state, undoStack, redoStack: [] };
    }

    case 'ADD_POINT': {
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== action.pathId) return p;
        return { ...p, commands: [...p.commands, action.command] };
      });
      const undoStack = [...state.undoStack.slice(-MAX_UNDO + 1), prev];
      return { ...state, paths: newPaths, undoStack, redoStack: [], isDirty: true };
    }

    case 'SET_SELECTION': {
      return { 
        ...state, 
        selection: { 
          pointIds: action.pointIds, 
          segmentIds: action.segmentIds ?? new Set() 
        } 
      };
    }

    case 'TOGGLE_SELECTION': {
      const ids = new Set(state.selection.pointIds);
      if (ids.has(action.pointId)) ids.delete(action.pointId);
      else ids.add(action.pointId);
      return { ...state, selection: { ...state.selection, pointIds: ids } };
    }

    case 'TOGGLE_SEGMENT_SELECTION': {
      const ids = new Set(state.selection.segmentIds);
      if (ids.has(action.segmentId)) ids.delete(action.segmentId);
      else ids.add(action.segmentId);
      return { ...state, selection: { ...state.selection, segmentIds: ids } };
    }

    case 'CLEAR_SELECTION': {
      return { ...state, selection: { pointIds: new Set(), segmentIds: new Set() } };
    }

    case 'SET_TOOL_MODE': {
      return { ...state, toolMode: action.mode, selection: { pointIds: new Set(), segmentIds: new Set() } };
    }

    case 'SET_VIEW_TRANSFORM': {
      return { ...state, viewTransform: action.vt };
    }

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      const redoStack = [clonePaths(state.paths), ...state.redoStack];
      return {
        ...state,
        paths: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack,
        isDirty: true,
        selection: { pointIds: new Set(), segmentIds: new Set() },
        activePathId: null,
        isDrawingPath: false,
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[0];
      const undoStack = [...state.undoStack, clonePaths(state.paths)];
      return {
        ...state,
        paths: next,
        undoStack,
        redoStack: state.redoStack.slice(1),
        isDirty: true,
        selection: { pointIds: new Set(), segmentIds: new Set() },
        activePathId: null,
        isDrawingPath: false,
      };
    }

    case 'MARK_SAVED': {
      return { ...state, isDirty: false, isSaving: false };
    }

    case 'SET_SAVING': {
      return { ...state, isSaving: action.saving };
    }

    case 'SET_SHOW_DIRECTION': {
      return { ...state, showDirection: action.showDirection };
    }

    case 'SET_SHOW_COORDINATES': {
      return { ...state, showCoordinates: action.showCoordinates };
    }

    case 'SET_ACTIVE_PATH': {
      return { ...state, activePathId: action.pathId };
    }

    case 'SET_DRAWING_STATE': {
      return { ...state, isDrawingPath: action.isDrawing };
    }

    case 'START_NEW_PATH': {
      const prev = clonePaths(state.paths);
      return {
        ...state,
        paths: [...state.paths, action.path],
        activePathId: action.path.id,
        isDrawingPath: true,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'APPEND_TO_ACTIVE_PATH': {
      if (!state.activePathId) return state;
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== state.activePathId) return p;
        return { ...p, commands: [...p.commands, action.command] };
      });
      return {
        ...state,
        paths: newPaths,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'CLOSE_ACTIVE_PATH': {
      if (!state.activePathId) return state;
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== state.activePathId) return p;
        const hasZ = p.commands[p.commands.length - 1]?.kind === 'Z';
        if (hasZ) return p;
        return { ...p, commands: [...p.commands, { kind: 'Z' as const }] };
      });
      return {
        ...state,
        paths: newPaths,
        isDrawingPath: false,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'DELETE_SELECTED_POINTS': {
      if (state.selection.pointIds.size === 0) return state;
      const prev = clonePaths(state.paths);
      // Filter out selected points - simplified version
      const newPaths = state.paths.map((path) => ({
        ...path,
        commands: path.commands.filter((cmd) => {
          if (cmd.kind === 'M' || cmd.kind === 'L') {
            return !state.selection.pointIds.has(cmd.point.id);
          }
          if (cmd.kind === 'Q') {
            return !state.selection.pointIds.has(cmd.point.id) && !state.selection.pointIds.has(cmd.ctrl.id);
          }
          if (cmd.kind === 'C') {
            return !state.selection.pointIds.has(cmd.point.id) &&
                   !state.selection.pointIds.has(cmd.ctrl1.id) &&
                   !state.selection.pointIds.has(cmd.ctrl2.id);
          }
          return true;
        }),
      })).filter((p) => p.commands.length > 0);
      
      // Check if active path still exists
      const activePathStillExists = state.activePathId && newPaths.some(p => p.id === state.activePathId);
      
      return {
        ...state,
        paths: newPaths,
        selection: { pointIds: new Set(), segmentIds: new Set() },
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
        activePathId: activePathStillExists ? state.activePathId : null,
        isDrawingPath: activePathStillExists ? state.isDrawingPath : false,
      };
    }

    case 'REVERSE_PATH_DIRECTION': {
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== action.pathId) return p;
        // Simplified: just toggle a flag for direction (full reversal is complex)
        return p;
      });
      return {
        ...state,
        paths: newPaths,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'TOGGLE_PATH_CLOSED': {
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== action.pathId) return p;
        const lastCmd = p.commands[p.commands.length - 1];
        if (lastCmd?.kind === 'Z') {
          return { ...p, commands: p.commands.slice(0, -1) };
        } else {
          return { ...p, commands: [...p.commands, { kind: 'Z' as const }] };
        }
      });
      return {
        ...state,
        paths: newPaths,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'CONVERT_SEGMENT_TYPE': {
      // Simplified - would need more complex logic for proper conversion
      return state;
    }

    case 'COPY_SELECTED_POINTS': {
      if (state.selection.pointIds.size === 0) return state;
      const pointsToCopy: EditablePoint[] = [];
      for (const path of state.paths) {
        for (const cmd of path.commands) {
          if (cmd.kind === 'M' || cmd.kind === 'L') {
            if (state.selection.pointIds.has(cmd.point.id)) {
              pointsToCopy.push({ ...cmd.point });
            }
          } else if (cmd.kind === 'Q') {
            if (state.selection.pointIds.has(cmd.ctrl.id)) {
              pointsToCopy.push({ ...cmd.ctrl });
            }
            if (state.selection.pointIds.has(cmd.point.id)) {
              pointsToCopy.push({ ...cmd.point });
            }
          } else if (cmd.kind === 'C') {
            if (state.selection.pointIds.has(cmd.ctrl1.id)) {
              pointsToCopy.push({ ...cmd.ctrl1 });
            }
            if (state.selection.pointIds.has(cmd.ctrl2.id)) {
              pointsToCopy.push({ ...cmd.ctrl2 });
            }
            if (state.selection.pointIds.has(cmd.point.id)) {
              pointsToCopy.push({ ...cmd.point });
            }
          }
        }
      }
      return { ...state, clipboard: pointsToCopy };
    }

    case 'PASTE_POINTS': {
      if (state.clipboard.length === 0 || !state.activePathId) return state;
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== state.activePathId) return p;
        const newCommands = [...p.commands];
        // Remove trailing Z if present
        const hasZ = newCommands[newCommands.length - 1]?.kind === 'Z';
        if (hasZ) newCommands.pop();
        
        for (const pt of state.clipboard) {
          const newId = `pt-paste-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          newCommands.push({
            kind: 'L' as const,
            point: { ...pt, id: newId, x: pt.x + 50, y: pt.y + 50 },
          });
        }
        if (hasZ) newCommands.push({ kind: 'Z' as const });
        return { ...p, commands: newCommands };
      });
      return {
        ...state,
        paths: newPaths,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'ADD_POINT_ON_SEGMENT': {
      const prev = clonePaths(state.paths);
      const newPaths = state.paths.map((p) => {
        if (p.id !== action.pathId) return p;
        const newCommands = [...p.commands];
        // Insert point at the specified index
        newCommands.splice(action.insertIndex, 0, { kind: 'L' as const, point: action.point });
        return { ...p, commands: newCommands };
      });
      return {
        ...state,
        paths: newPaths,
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    default:
      return state;
  }
}

export function makeInitialState(vt: ViewTransform): EditorState {
  return {
    paths: [],
    selection: { pointIds: new Set(), segmentIds: new Set() },
    toolMode: 'pen',
    viewTransform: vt,
    isDirty: false,
    isSaving: false,
    undoStack: [],
    redoStack: [],
    showDirection: false,
    showCoordinates: false,
    activePathId: null,
    isDrawingPath: false,
    clipboard: [],
  };
}

export function useGlyphEditor(initialVt: ViewTransform) {
  return useReducer(reducer, initialVt, makeInitialState);
}

export { getPoint };
