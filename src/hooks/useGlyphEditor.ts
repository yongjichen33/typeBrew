import { useReducer } from 'react';
import type {
  EditorAction,
  EditorState,
  EditablePath,
  EditablePoint,
  ViewTransform,
  PathCommand,
  ClipboardData,
  Selection,
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

export function computeClipboardData(paths: EditablePath[], selection: Selection): ClipboardData {
  const clipboard: ClipboardData = { points: [], segments: [] };
  
  for (const path of paths) {
    let lastOnCurve: EditablePoint | null = null;
    
    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        if (selection.pointIds.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          selection.pointIds.has(cmd.point.id);
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            kind: 'L',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
          });
        } else if (selection.pointIds.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          selection.pointIds.has(cmd.point.id) ||
          selection.pointIds.has(cmd.ctrl.id);
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            kind: 'Q',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
            ctrl1: { ...cmd.ctrl },
          });
        } else if (selection.pointIds.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          selection.pointIds.has(cmd.point.id) ||
          selection.pointIds.has(cmd.ctrl1.id) ||
          selection.pointIds.has(cmd.ctrl2.id);
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            kind: 'C',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
            ctrl1: { ...cmd.ctrl1 },
            ctrl2: { ...cmd.ctrl2 },
          });
        } else if (selection.pointIds.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
        lastOnCurve = cmd.point;
      }
    }
  }
  
  return clipboard;
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
      return { ...state, paths: applyPointDelta(state.paths, action.deltas), isDirty: true };
    }

    case 'COMMIT_MOVE': {
      const undoStack = [...state.undoStack.slice(-MAX_UNDO + 1), action.snapshot];
      return { ...state, undoStack, redoStack: [] };
    }

    case 'TRANSFORM_POINTS_LIVE': {
      return { ...state, paths: applyPointDelta(state.paths, action.deltas), isDirty: true };
    }

    case 'COMMIT_TRANSFORM': {
      const undoStack = [...state.undoStack.slice(-MAX_UNDO + 1), action.snapshot];
      return { ...state, undoStack, redoStack: [] };
    }

    case 'APPLY_TRANSFORM': {
      const { translateX = 0, translateY = 0, scaleX = 1, scaleY = 1, rotation = 0, centerX, centerY } = action.transform;
      const prev = clonePaths(state.paths);
      
      const cos = Math.cos(rotation * Math.PI / 180);
      const sin = Math.sin(rotation * Math.PI / 180);
      
      const newPaths = state.paths.map((path) => ({
        ...path,
        commands: path.commands.map((cmd) => {
          if (cmd.kind === 'M' || cmd.kind === 'L') {
            let x = cmd.point.x;
            let y = cmd.point.y;
            x = centerX + (x - centerX) * scaleX;
            y = centerY + (y - centerY) * scaleY;
            const rx = centerX + (x - centerX) * cos - (y - centerY) * sin;
            const ry = centerY + (x - centerX) * sin + (y - centerY) * cos;
            return { ...cmd, point: { ...cmd.point, x: rx + translateX, y: ry + translateY } };
          } else if (cmd.kind === 'Q') {
            let cx = cmd.ctrl.x, cy = cmd.ctrl.y;
            cx = centerX + (cx - centerX) * scaleX;
            cy = centerY + (cy - centerY) * scaleY;
            const rcx = centerX + (cx - centerX) * cos - (cy - centerY) * sin;
            const rcy = centerY + (cx - centerX) * sin + (cy - centerY) * cos;
            
            let px = cmd.point.x, py = cmd.point.y;
            px = centerX + (px - centerX) * scaleX;
            py = centerY + (py - centerY) * scaleY;
            const rpx = centerX + (px - centerX) * cos - (py - centerY) * sin;
            const rpy = centerY + (px - centerX) * sin + (py - centerY) * cos;
            
            return { ...cmd, ctrl: { ...cmd.ctrl, x: rcx + translateX, y: rcy + translateY }, point: { ...cmd.point, x: rpx + translateX, y: rpy + translateY } };
          } else if (cmd.kind === 'C') {
            let c1x = cmd.ctrl1.x, c1y = cmd.ctrl1.y;
            c1x = centerX + (c1x - centerX) * scaleX;
            c1y = centerY + (c1y - centerY) * scaleY;
            const rc1x = centerX + (c1x - centerX) * cos - (c1y - centerY) * sin;
            const rc1y = centerY + (c1x - centerX) * sin + (c1y - centerY) * cos;
            
            let c2x = cmd.ctrl2.x, c2y = cmd.ctrl2.y;
            c2x = centerX + (c2x - centerX) * scaleX;
            c2y = centerY + (c2y - centerY) * scaleY;
            const rc2x = centerX + (c2x - centerX) * cos - (c2y - centerY) * sin;
            const rc2y = centerY + (c2x - centerX) * sin + (c2y - centerY) * cos;
            
            let px = cmd.point.x, py = cmd.point.y;
            px = centerX + (px - centerX) * scaleX;
            py = centerY + (py - centerY) * scaleY;
            const rpx = centerX + (px - centerX) * cos - (py - centerY) * sin;
            const rpy = centerY + (px - centerX) * sin + (py - centerY) * cos;
            
            return { 
              ...cmd, 
              ctrl1: { ...cmd.ctrl1, x: rc1x + translateX, y: rc1y + translateY },
              ctrl2: { ...cmd.ctrl2, x: rc2x + translateX, y: rc2y + translateY },
              point: { ...cmd.point, x: rpx + translateX, y: rpy + translateY }
            };
          }
          return cmd;
        }),
      }));
      
      const undoStack = [...state.undoStack.slice(-MAX_UNDO + 1), prev];
      return { ...state, paths: newPaths, undoStack, redoStack: [], isDirty: true };
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
      return state;
    }

    case 'CONVERT_SEGMENT_TO_CURVE': {
      const { segmentId, curveType } = action;
      const [pathId, startPointId] = segmentId.split(':');
      
      const prev = clonePaths(state.paths);
      let startPoint: EditablePoint | null = null;
      
      const newPaths = state.paths.map((path) => {
        if (path.id !== pathId) return path;
        
        const newCommands: PathCommand[] = [];
        
        for (let i = 0; i < path.commands.length; i++) {
          const cmd = path.commands[i];
          
          if (cmd.kind === 'M') {
            if (cmd.point.id === startPointId) {
              startPoint = cmd.point;
            }
            newCommands.push(cmd);
          } else if (cmd.kind === 'L') {
            if (startPoint && segmentId === `${pathId}:${startPoint.id}:${cmd.point.id}`) {
              const endPoint = cmd.point;
              const midX = (startPoint.x + endPoint.x) / 2;
              const midY = (startPoint.y + endPoint.y) / 2;
              
              if (curveType === 'quadratic') {
                const ctrlId = `ctrl-${Date.now()}`;
                newCommands.push({
                  kind: 'Q' as const,
                  ctrl: {
                    id: ctrlId,
                    x: midX,
                    y: midY,
                    type: 'off-curve-quad' as const,
                  },
                  point: endPoint,
                });
              } else {
                const ctrl1Id = `ctrl1-${Date.now()}`;
                const ctrl2Id = `ctrl2-${Date.now()}`;
                const thirdX = startPoint.x + (endPoint.x - startPoint.x) / 3;
                const thirdY = startPoint.y + (endPoint.y - startPoint.y) / 3;
                const twoThirdX = startPoint.x + 2 * (endPoint.x - startPoint.x) / 3;
                const twoThirdY = startPoint.y + 2 * (endPoint.y - startPoint.y) / 3;
                
                newCommands.push({
                  kind: 'C' as const,
                  ctrl1: {
                    id: ctrl1Id,
                    x: thirdX,
                    y: thirdY,
                    type: 'off-curve-cubic' as const,
                  },
                  ctrl2: {
                    id: ctrl2Id,
                    x: twoThirdX,
                    y: twoThirdY,
                    type: 'off-curve-cubic' as const,
                  },
                  point: endPoint,
                });
              }
            } else {
              newCommands.push(cmd);
            }
            startPoint = cmd.point;
          } else if (cmd.kind === 'Q') {
            if (cmd.point.id === startPointId) {
              startPoint = cmd.point;
            }
            newCommands.push(cmd);
            startPoint = cmd.point;
          } else if (cmd.kind === 'C') {
            if (cmd.point.id === startPointId) {
              startPoint = cmd.point;
            }
            newCommands.push(cmd);
            startPoint = cmd.point;
          } else {
            newCommands.push(cmd);
          }
        }
        
        return { ...path, commands: newCommands };
      });
      
      const newPointIds = new Set(state.selection.pointIds);
      for (const path of newPaths) {
        if (path.id === pathId) {
          for (const cmd of path.commands) {
            if (cmd.kind === 'Q' && cmd.ctrl.id.startsWith('ctrl-')) {
              newPointIds.add(cmd.ctrl.id);
            } else if (cmd.kind === 'C') {
              if (cmd.ctrl1.id.startsWith('ctrl1-')) newPointIds.add(cmd.ctrl1.id);
              if (cmd.ctrl2.id.startsWith('ctrl2-')) newPointIds.add(cmd.ctrl2.id);
            }
          }
        }
      }
      
      return {
        ...state,
        paths: newPaths,
        selection: { ...state.selection, pointIds: newPointIds },
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'PASTE_CLIPBOARD': {
      const { points, segments } = action.clipboard;
      if (points.length === 0 && segments.length === 0) return state;
      
      const prev = clonePaths(state.paths);
      const offsetX = action.offsetX ?? 50;
      const offsetY = action.offsetY ?? 50;
      
      const newPathId = `path-paste-${Date.now()}`;
      const newCommands: PathCommand[] = [];
      let idCounter = 0;
      const genId = () => `pt-paste-${Date.now()}-${++idCounter}`;
      
      for (const seg of segments) {
        const startId = genId();
        const endId = genId();
        
        newCommands.push({
          kind: 'M' as const,
          point: {
            id: startId,
            x: seg.startPoint.x + offsetX,
            y: seg.startPoint.y + offsetY,
            type: 'on-curve' as const,
          },
        });
        
        if (seg.kind === 'L') {
          newCommands.push({
            kind: 'L' as const,
            point: {
              id: endId,
              x: seg.endPoint.x + offsetX,
              y: seg.endPoint.y + offsetY,
              type: 'on-curve' as const,
            },
          });
        } else if (seg.kind === 'Q') {
          const ctrlId = genId();
          const ctrl = seg.ctrl1!;
          newCommands.push({
            kind: 'Q' as const,
            ctrl: {
              id: ctrlId,
              x: ctrl.x + offsetX,
              y: ctrl.y + offsetY,
              type: 'off-curve-quad' as const,
            },
            point: {
              id: endId,
              x: seg.endPoint.x + offsetX,
              y: seg.endPoint.y + offsetY,
              type: 'on-curve' as const,
            },
          });
        } else if (seg.kind === 'C') {
          const ctrl1Id = genId();
          const ctrl2Id = genId();
          const ctrl1 = seg.ctrl1!;
          const ctrl2 = seg.ctrl2!;
          newCommands.push({
            kind: 'C' as const,
            ctrl1: {
              id: ctrl1Id,
              x: ctrl1.x + offsetX,
              y: ctrl1.y + offsetY,
              type: 'off-curve-cubic' as const,
            },
            ctrl2: {
              id: ctrl2Id,
              x: ctrl2.x + offsetX,
              y: ctrl2.y + offsetY,
              type: 'off-curve-cubic' as const,
            },
            point: {
              id: endId,
              x: seg.endPoint.x + offsetX,
              y: seg.endPoint.y + offsetY,
              type: 'on-curve' as const,
            },
          });
        }
      }
      
      for (const pt of points) {
        const pointId = genId();
        if (newCommands.length === 0) {
          newCommands.push({
            kind: 'M' as const,
            point: {
              id: pointId,
              x: pt.x + offsetX,
              y: pt.y + offsetY,
              type: 'on-curve' as const,
            },
          });
        } else {
          newCommands.push({
            kind: 'L' as const,
            point: {
              id: pointId,
              x: pt.x + offsetX,
              y: pt.y + offsetY,
              type: 'on-curve' as const,
            },
          });
        }
      }
      
      if (newCommands.length === 0) return state;
      
      const newPath: EditablePath = {
        id: newPathId,
        commands: newCommands,
      };
      
      return {
        ...state,
        paths: [...state.paths, newPath],
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
  };
}

export function useGlyphEditor(initialVt: ViewTransform) {
  return useReducer(reducer, initialVt, makeInitialState);
}

export { getPoint };
