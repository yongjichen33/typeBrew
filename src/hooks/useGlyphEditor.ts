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
  FontMetrics,
  DrawingLayer,
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
  const pointsInSegments = new Set<string>();
  
  for (const path of paths) {
    let lastOnCurve: EditablePoint | null = null;
    let firstOnCurve: EditablePoint | null = null;
    const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
    
    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        lastOnCurve = cmd.point;
        firstOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          (selection.pointIds.has(lastOnCurve.id) && selection.pointIds.has(cmd.point.id));
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            pathId: path.id,
            kind: 'L',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
          });
          pointsInSegments.add(lastOnCurve.id);
          pointsInSegments.add(cmd.point.id);
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          (selection.pointIds.has(lastOnCurve.id) && selection.pointIds.has(cmd.point.id));
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            pathId: path.id,
            kind: 'Q',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
            ctrl1: { ...cmd.ctrl },
          });
          pointsInSegments.add(lastOnCurve.id);
          pointsInSegments.add(cmd.point.id);
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        const shouldCopySegment = selection.segmentIds.has(segmentId) ||
          (selection.pointIds.has(lastOnCurve.id) && selection.pointIds.has(cmd.point.id));
        
        if (shouldCopySegment) {
          clipboard.segments.push({
            pathId: path.id,
            kind: 'C',
            startPoint: { ...lastOnCurve },
            endPoint: { ...cmd.point },
            ctrl1: { ...cmd.ctrl1 },
            ctrl2: { ...cmd.ctrl2 },
          });
          pointsInSegments.add(lastOnCurve.id);
          pointsInSegments.add(cmd.point.id);
        }
        lastOnCurve = cmd.point;
      }
    }
    
    // Handle closing segment in closed path
    if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
      const segmentId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
      const shouldCopySegment = selection.segmentIds.has(segmentId) ||
        (selection.pointIds.has(lastOnCurve.id) && selection.pointIds.has(firstOnCurve.id));
      
      if (shouldCopySegment) {
        clipboard.segments.push({
          pathId: path.id,
          kind: 'L',
          startPoint: { ...lastOnCurve },
          endPoint: { ...firstOnCurve },
        });
        pointsInSegments.add(lastOnCurve.id);
        pointsInSegments.add(firstOnCurve.id);
      }
    }
  }
  
  // Add loose points that aren't part of any segment
  for (const path of paths) {
    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        if (selection.pointIds.has(cmd.point.id) && !pointsInSegments.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
      } else if (cmd.kind === 'L') {
        if (selection.pointIds.has(cmd.point.id) && !pointsInSegments.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
      } else if (cmd.kind === 'Q') {
        if (selection.pointIds.has(cmd.point.id) && !pointsInSegments.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
      } else if (cmd.kind === 'C') {
        if (selection.pointIds.has(cmd.point.id) && !pointsInSegments.has(cmd.point.id)) {
          clipboard.points.push({ ...cmd.point });
        }
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
      const { selection } = action;
      const prev = clonePaths(state.paths);
      
      const cos = Math.cos(rotation * Math.PI / 180);
      const sin = Math.sin(rotation * Math.PI / 180);
      
      const transformPoint = (x: number, y: number): { x: number; y: number } => {
        const sx = centerX + (x - centerX) * scaleX;
        const sy = centerY + (y - centerY) * scaleY;
        const rx = centerX + (sx - centerX) * cos - (sy - centerY) * sin;
        const ry = centerY + (sx - centerX) * sin + (sy - centerY) * cos;
        return { x: rx + translateX, y: ry + translateY };
      };
      
      const pointsToTransform = new Set<string>(selection.pointIds);
      
      for (const path of state.paths) {
        let lastOnCurveId: string | null = null;
        let firstOnCurveId: string | null = null;
        const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
        
        for (const cmd of path.commands) {
          if (cmd.kind === 'M') {
            lastOnCurveId = cmd.point.id;
            firstOnCurveId = cmd.point.id;
          } else if (cmd.kind === 'L' && lastOnCurveId) {
            const segmentId = `${path.id}:${lastOnCurveId}:${cmd.point.id}`;
            if (selection.segmentIds.has(segmentId)) {
              pointsToTransform.add(lastOnCurveId);
              pointsToTransform.add(cmd.point.id);
            }
            lastOnCurveId = cmd.point.id;
          } else if (cmd.kind === 'Q' && lastOnCurveId) {
            const segmentId = `${path.id}:${lastOnCurveId}:${cmd.point.id}`;
            if (selection.segmentIds.has(segmentId)) {
              pointsToTransform.add(lastOnCurveId);
              pointsToTransform.add(cmd.ctrl.id);
              pointsToTransform.add(cmd.point.id);
            }
            lastOnCurveId = cmd.point.id;
          } else if (cmd.kind === 'C' && lastOnCurveId) {
            const segmentId = `${path.id}:${lastOnCurveId}:${cmd.point.id}`;
            if (selection.segmentIds.has(segmentId)) {
              pointsToTransform.add(lastOnCurveId);
              pointsToTransform.add(cmd.ctrl1.id);
              pointsToTransform.add(cmd.ctrl2.id);
              pointsToTransform.add(cmd.point.id);
            }
            lastOnCurveId = cmd.point.id;
          }
        }
        
        // Handle closing segment in closed path
        if (isClosed && lastOnCurveId && firstOnCurveId && lastOnCurveId !== firstOnCurveId) {
          const segmentId = `${path.id}:${lastOnCurveId}:${firstOnCurveId}`;
          if (selection.segmentIds.has(segmentId)) {
            pointsToTransform.add(lastOnCurveId);
            pointsToTransform.add(firstOnCurveId);
          }
        }
      }
      
      const newPaths = state.paths.map((path) => ({
        ...path,
        commands: path.commands.map((cmd) => {
          if (cmd.kind === 'M') {
            if (pointsToTransform.has(cmd.point.id)) {
              const { x, y } = transformPoint(cmd.point.x, cmd.point.y);
              return { ...cmd, point: { ...cmd.point, x, y } };
            }
            return cmd;
          } else if (cmd.kind === 'L') {
            if (pointsToTransform.has(cmd.point.id)) {
              const { x, y } = transformPoint(cmd.point.x, cmd.point.y);
              return { ...cmd, point: { ...cmd.point, x, y } };
            }
            return cmd;
          } else if (cmd.kind === 'Q') {
            let newCmd = cmd;
            if (pointsToTransform.has(cmd.ctrl.id)) {
              const { x, y } = transformPoint(cmd.ctrl.x, cmd.ctrl.y);
              newCmd = { ...newCmd, ctrl: { ...cmd.ctrl, x, y } };
            }
            if (pointsToTransform.has(cmd.point.id)) {
              const { x, y } = transformPoint(cmd.point.x, cmd.point.y);
              newCmd = { ...newCmd, point: { ...cmd.point, x, y } };
            }
            return newCmd;
          } else if (cmd.kind === 'C') {
            let newCmd = cmd;
            if (pointsToTransform.has(cmd.ctrl1.id)) {
              const { x, y } = transformPoint(cmd.ctrl1.x, cmd.ctrl1.y);
              newCmd = { ...newCmd, ctrl1: { ...cmd.ctrl1, x, y } };
            }
            if (pointsToTransform.has(cmd.ctrl2.id)) {
              const { x, y } = transformPoint(cmd.ctrl2.x, cmd.ctrl2.y);
              newCmd = { ...newCmd, ctrl2: { ...cmd.ctrl2, x, y } };
            }
            if (pointsToTransform.has(cmd.point.id)) {
              const { x, y } = transformPoint(cmd.point.x, cmd.point.y);
              newCmd = { ...newCmd, point: { ...cmd.point, x, y } };
            }
            return newCmd;
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

    case 'CENTER_VIEW': {
      const { canvasWidth, canvasHeight } = action;
      const metrics: FontMetrics = action.metrics;
      const glyphH = (metrics.yMax - metrics.yMin) || metrics.unitsPerEm;
      const glyphW = (metrics.xMax - metrics.xMin) || metrics.advanceWidth || metrics.unitsPerEm;
      
      if (glyphW === 0 || glyphH === 0) {
        return { ...state, viewTransform: { scale: 1, originX: canvasWidth / 2, originY: canvasHeight / 2 } };
      }
      
      const padding = 0.15;
      const scale = Math.min(
        (canvasWidth * (1 - 2 * padding)) / glyphW,
        (canvasHeight * (1 - 2 * padding)) / glyphH,
      );
      const centerFontX = (metrics.xMin + metrics.xMax) / 2;
      const centerFontY = (metrics.yMin + metrics.yMax) / 2;
      
      return {
        ...state,
        viewTransform: {
          scale,
          originX: canvasWidth / 2 - centerFontX * scale,
          originY: canvasHeight / 2 + centerFontY * scale,
        },
      };
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
      if (state.selection.pointIds.size === 0 && state.selection.segmentIds.size === 0) return state;
      const prev = clonePaths(state.paths);
      
      // Collect all point IDs to delete (selected points + endpoints of selected segments)
      const pointIdsToDelete = new Set(state.selection.pointIds);
      
      for (const segmentId of state.selection.segmentIds) {
        const [, startPointId, endPointId] = segmentId.split(':');
        pointIdsToDelete.add(startPointId);
        pointIdsToDelete.add(endPointId);
      }
      
      const newPaths = state.paths.map((path) => ({
        ...path,
        commands: path.commands.filter((cmd) => {
          if (cmd.kind === 'M' || cmd.kind === 'L') {
            return !pointIdsToDelete.has(cmd.point.id);
          }
          if (cmd.kind === 'Q') {
            return !pointIdsToDelete.has(cmd.point.id) && !pointIdsToDelete.has(cmd.ctrl.id);
          }
          if (cmd.kind === 'C') {
            return !pointIdsToDelete.has(cmd.point.id) &&
                   !pointIdsToDelete.has(cmd.ctrl1.id) &&
                   !pointIdsToDelete.has(cmd.ctrl2.id);
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

    case 'ADD_POINT_ON_SEGMENT': {
      const { pathId, insertIndex, point } = action;
      const prev = clonePaths(state.paths);
      
      const newPaths = state.paths.map((path) => {
        if (path.id !== pathId) return path;
        
        const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
        // For closing segments, insertIndex === cmds.length, so insert before Z
        const actualIndex = (isClosed && insertIndex === path.commands.length)
          ? path.commands.length - 1
          : insertIndex;
        
        const newCommands = [...path.commands];
        newCommands.splice(actualIndex, 0, {
          kind: 'L' as const,
          point,
        });
        
        return { ...path, commands: newCommands };
      });
      
      return {
        ...state,
        paths: newPaths,
        selection: { pointIds: new Set([point.id]), segmentIds: new Set() },
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'CONVERT_SEGMENT_TO_CURVE': {
      const { segmentId, curveType } = action;
      const [pathId, startPointId, endPointId] = segmentId.split(':');
      
      const prev = clonePaths(state.paths);
      
      const newPaths = state.paths.map((path) => {
        if (path.id !== pathId) return path;
        
        const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
        
        // Find start and end points
        let startPoint: EditablePoint | null = null;
        let endPoint: EditablePoint | null = null;
        
        for (const cmd of path.commands) {
          if (cmd.kind === 'M' || cmd.kind === 'L') {
            if (cmd.point.id === startPointId) startPoint = cmd.point;
            if (cmd.point.id === endPointId) endPoint = cmd.point;
          } else if (cmd.kind === 'Q') {
            if (cmd.point.id === startPointId) startPoint = cmd.point;
            if (cmd.point.id === endPointId) endPoint = cmd.point;
          } else if (cmd.kind === 'C') {
            if (cmd.point.id === startPointId) startPoint = cmd.point;
            if (cmd.point.id === endPointId) endPoint = cmd.point;
          }
        }
        
        if (!startPoint || !endPoint) return path;
        
        // Check if this is the closing segment
        const isClosingSegment = isClosed && 
          path.commands[path.commands.length - 2]?.kind === 'L' &&
          (path.commands[path.commands.length - 2] as { kind: 'L'; point: EditablePoint }).point.id === startPointId &&
          path.commands[0].kind === 'M' &&
          path.commands[0].point.id === endPointId;
        
        const newCommands: PathCommand[] = [];
        
        if (isClosingSegment) {
          // Handle closing segment - insert curve before Z
          for (let i = 0; i < path.commands.length - 1; i++) {
            newCommands.push(path.commands[i]);
          }
          
          if (curveType === 'quadratic') {
            const ctrlId = `ctrl-${Date.now()}`;
            const midX = (startPoint.x + endPoint.x) / 2;
            const midY = (startPoint.y + endPoint.y) / 2;
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
          newCommands.push({ kind: 'Z' as const });
        } else {
          // Regular segment - find and replace L command
          let lastOnCurveId: string | null = null;
          
          for (const cmd of path.commands) {
            if (cmd.kind === 'M') {
              lastOnCurveId = cmd.point.id;
              newCommands.push(cmd);
            } else if (cmd.kind === 'L') {
              if (lastOnCurveId === startPointId && cmd.point.id === endPointId) {
                // This is the segment to convert
                if (curveType === 'quadratic') {
                  const ctrlId = `ctrl-${Date.now()}`;
                  const midX = (startPoint.x + cmd.point.x) / 2;
                  const midY = (startPoint.y + cmd.point.y) / 2;
                  newCommands.push({
                    kind: 'Q' as const,
                    ctrl: {
                      id: ctrlId,
                      x: midX,
                      y: midY,
                      type: 'off-curve-quad' as const,
                    },
                    point: cmd.point,
                  });
                } else {
                  const ctrl1Id = `ctrl1-${Date.now()}`;
                  const ctrl2Id = `ctrl2-${Date.now()}`;
                  const thirdX = startPoint.x + (cmd.point.x - startPoint.x) / 3;
                  const thirdY = startPoint.y + (cmd.point.y - startPoint.y) / 3;
                  const twoThirdX = startPoint.x + 2 * (cmd.point.x - startPoint.x) / 3;
                  const twoThirdY = startPoint.y + 2 * (cmd.point.y - startPoint.y) / 3;
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
                    point: cmd.point,
                  });
                }
              } else {
                newCommands.push(cmd);
              }
              lastOnCurveId = cmd.point.id;
            } else {
              newCommands.push(cmd);
              if (cmd.kind === 'Q') lastOnCurveId = cmd.point.id;
              else if (cmd.kind === 'C') lastOnCurveId = cmd.point.id;
            }
          }
        }
        
        return { ...path, commands: newCommands };
      });
      
      return {
        ...state,
        paths: newPaths,
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
      
      const newPointIds = new Set<string>();
      const newPaths: EditablePath[] = [];
      let idCounter = 0;
      const genId = () => `pt-paste-${Date.now()}-${++idCounter}`;
      
      // Helper to create point key for deduplication
      const pointKey = (pt: { x: number; y: number }) => 
        `${Math.round(pt.x * 1000)}:${Math.round(pt.y * 1000)}`;
      
      // Group segments by their original pathId
      const segmentsByPath = new Map<string, typeof segments>();
      for (const seg of segments) {
        const group = segmentsByPath.get(seg.pathId) || [];
        group.push(seg);
        segmentsByPath.set(seg.pathId, group);
      }
      
      // Create a separate path for each original path group
      for (const [, pathSegments] of segmentsByPath) {
        const newPathId = `path-paste-${Date.now()}-${newPaths.length}`;
        const newCommands: PathCommand[] = [];
        const pointIdMap = new Map<string, string>();
        
        // Get or create a point ID, reusing if same position exists
        const getOrCreatePointId = (origPt: { x: number; y: number }): string => {
          const key = pointKey(origPt);
          if (pointIdMap.has(key)) {
            return pointIdMap.get(key)!;
          }
          const newId = genId();
          pointIdMap.set(key, newId);
          newPointIds.add(newId);
          return newId;
        };
        
        // Build a connected chain of segments
        // Collect all unique points and their connections
        const pointConnections = new Map<string, Array<{ seg: typeof pathSegments[0]; dir: 'forward' | 'reverse' }>>();
        
        for (const seg of pathSegments) {
          const startKey = pointKey(seg.startPoint);
          const endKey = pointKey(seg.endPoint);
          
          if (!pointConnections.has(startKey)) pointConnections.set(startKey, []);
          if (!pointConnections.has(endKey)) pointConnections.set(endKey, []);
          
          pointConnections.get(startKey)!.push({ seg, dir: 'forward' });
          pointConnections.get(endKey)!.push({ seg, dir: 'reverse' });
        }
        
        // Find starting point (a point with only one connection, or any point if all are connected twice)
        let startKey: string | null = null;
        for (const [key, conns] of pointConnections) {
          if (conns.length === 1) {
            startKey = key;
            break;
          }
        }
        if (!startKey && pointConnections.size > 0) {
          startKey = pointConnections.keys().next().value ?? null;
        }
        
        // Traverse the chain
        if (startKey) {
          const usedSegments = new Set<typeof pathSegments[0]>();
          let currentKey = startKey;
          
          // Add starting M command
          const startSeg = pointConnections.get(currentKey)?.[0];
          if (startSeg) {
            const pt = startSeg.dir === 'forward' ? startSeg.seg.startPoint : startSeg.seg.endPoint;
            const startId = getOrCreatePointId(pt);
            newCommands.push({
              kind: 'M' as const,
              point: { id: startId, x: pt.x + offsetX, y: pt.y + offsetY, type: 'on-curve' as const },
            });
          }
          
          while (true) {
            const conns = pointConnections.get(currentKey);
            if (!conns) break;
            
            // Find next unused segment
            let found = false;
            for (const { seg, dir } of conns) {
              if (usedSegments.has(seg)) continue;
              
              // Check if this segment starts from current point
              const segStartKey = pointKey(seg.startPoint);
              if ((dir === 'forward' && segStartKey === currentKey) || 
                  (dir === 'reverse' && segStartKey !== currentKey)) {
                // This segment continues from current point
                usedSegments.add(seg);
                
                const nextPt = dir === 'forward' ? seg.endPoint : seg.startPoint;
                const nextKey = pointKey(nextPt);
                const nextId = getOrCreatePointId(nextPt);
                
                if (seg.kind === 'L') {
                  newCommands.push({
                    kind: 'L' as const,
                    point: { id: nextId, x: nextPt.x + offsetX, y: nextPt.y + offsetY, type: 'on-curve' as const },
                  });
                } else if (seg.kind === 'Q') {
                  const ctrl = seg.ctrl1!;
                  const ctrlId = genId();
                  newPointIds.add(ctrlId);
                  newCommands.push({
                    kind: 'Q' as const,
                    ctrl: { id: ctrlId, x: ctrl.x + offsetX, y: ctrl.y + offsetY, type: 'off-curve-quad' as const },
                    point: { id: nextId, x: nextPt.x + offsetX, y: nextPt.y + offsetY, type: 'on-curve' as const },
                  });
                } else if (seg.kind === 'C') {
                  const ctrl1 = seg.ctrl1!;
                  const ctrl2 = seg.ctrl2!;
                  const ctrl1Id = genId();
                  const ctrl2Id = genId();
                  newPointIds.add(ctrl1Id);
                  newPointIds.add(ctrl2Id);
                  newCommands.push({
                    kind: 'C' as const,
                    ctrl1: { id: ctrl1Id, x: ctrl1.x + offsetX, y: ctrl1.y + offsetY, type: 'off-curve-cubic' as const },
                    ctrl2: { id: ctrl2Id, x: ctrl2.x + offsetX, y: ctrl2.y + offsetY, type: 'off-curve-cubic' as const },
                    point: { id: nextId, x: nextPt.x + offsetX, y: nextPt.y + offsetY, type: 'on-curve' as const },
                  });
                }
                
                currentKey = nextKey;
                found = true;
                break;
              }
            }
            
            if (!found) break;
          }
          
          // Check if path should be closed (we ended back at start)
          if (newCommands.length > 1 && currentKey === startKey) {
            // Remove the last command that goes back to start
            newCommands.pop();
            newCommands.push({ kind: 'Z' as const });
          }
        }
        
        if (newCommands.length > 0) {
          newPaths.push({ id: newPathId, commands: newCommands });
        }
      }
      
      // Handle loose points - create a separate path for them
      if (points.length > 0) {
        const pointsPathId = `path-paste-${Date.now()}-points`;
        const pointsCommands: PathCommand[] = [];
        
        for (const pt of points) {
          const pointId = genId();
          newPointIds.add(pointId);
          
          if (pointsCommands.length === 0) {
            pointsCommands.push({
              kind: 'M' as const,
              point: {
                id: pointId,
                x: pt.x + offsetX,
                y: pt.y + offsetY,
                type: 'on-curve' as const,
              },
            });
          } else {
            pointsCommands.push({
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
        
        if (pointsCommands.length > 0) {
          newPaths.push({ id: pointsPathId, commands: pointsCommands });
        }
      }
      
      if (newPaths.length === 0) return state;
      
      return {
        ...state,
        paths: [...state.paths, ...newPaths],
        selection: { pointIds: newPointIds, segmentIds: new Set() },
        undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), prev],
        redoStack: [],
        isDirty: true,
      };
    }

    case 'ADD_DRAWING_LAYER': {
      const updatedLayers = state.layers.map(l =>
        l.id === state.activeLayerId ? { ...l, paths: state.paths } : l,
      );
      return {
        ...state,
        layers: [...updatedLayers, action.layer],
        activeLayerId: action.layer.id,
        focusedLayerId: action.layer.id,
        paths: [],
        selection: { pointIds: new Set(), segmentIds: new Set() },
        undoStack: [], redoStack: [],
        isDirty: false,
      };
    }

    case 'ADD_IMAGE_LAYER':
      return { ...state, layers: [...state.layers, action.layer], focusedLayerId: action.layer.id };

    case 'SET_ACTIVE_LAYER': {
      if (action.layerId === state.activeLayerId) return { ...state, focusedLayerId: action.layerId };
      const target = state.layers.find(l => l.id === action.layerId);
      if (!target || target.type !== 'drawing') return state;
      const updatedLayers = state.layers.map(l =>
        l.id === state.activeLayerId ? { ...l, paths: state.paths } : l,
      );
      return {
        ...state,
        layers: updatedLayers,
        activeLayerId: action.layerId,
        focusedLayerId: action.layerId,
        paths: (target as DrawingLayer).paths,
        selection: { pointIds: new Set(), segmentIds: new Set() },
        undoStack: [], redoStack: [],
        isDirty: false,
        activePathId: null,
        isDrawingPath: false,
      };
    }

    case 'SET_FOCUSED_LAYER':
      return { ...state, focusedLayerId: action.layerId };

    case 'REMOVE_LAYER': {
      if (action.layerId === 'outline') return state;
      const newLayers = state.layers.filter(l => l.id !== action.layerId);
      const newFocused = state.focusedLayerId === action.layerId ? 'outline' : state.focusedLayerId;
      if (state.activeLayerId === action.layerId) {
        const outlineLayer = state.layers.find(l => l.id === 'outline') as DrawingLayer;
        return {
          ...state,
          layers: newLayers,
          activeLayerId: 'outline',
          focusedLayerId: 'outline',
          paths: outlineLayer?.paths ?? [],
          selection: { pointIds: new Set(), segmentIds: new Set() },
          undoStack: [], redoStack: [],
          isDirty: false,
          activePathId: null,
          isDrawingPath: false,
        };
      }
      return { ...state, layers: newLayers, focusedLayerId: newFocused };
    }

    case 'SET_LAYER_VISIBLE':
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId ? { ...l, visible: action.visible } : l,
        ),
      };

    case 'UPDATE_IMAGE_LAYER':
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId ? { ...l, ...action.updates } : l,
        ),
      };

    case 'RENAME_LAYER':
      return {
        ...state,
        layers: state.layers.map(l =>
          l.id === action.layerId ? { ...l, name: action.name } : l,
        ),
      };

    default:
      return state;
  }
}

export function makeInitialState(vt: ViewTransform): EditorState {
  return {
    paths: [],
    selection: { pointIds: new Set(), segmentIds: new Set() },
    toolMode: 'node',
    viewTransform: vt,
    isDirty: false,
    isSaving: false,
    undoStack: [],
    redoStack: [],
    showDirection: false,
    showCoordinates: false,
    activePathId: null,
    isDrawingPath: false,
    layers: [{ id: 'outline', type: 'drawing', name: 'Default', visible: true, paths: [] }],
    activeLayerId: 'outline',
    focusedLayerId: 'outline',
  };
}

export function useGlyphEditor(initialVt: ViewTransform) {
  return useReducer(reducer, initialVt, makeInitialState);
}

export { getPoint };
