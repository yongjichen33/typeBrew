import {
  RefreshCw,
  X,
  Circle,
  Copy,
  Plus,
  ArrowUp,
  ArrowDown,
  Spline,
  Eye,
  EyeOff,
  ImageIcon,
  PenLine,
  Trash2,
  ChevronRight,
  ChevronDown,
  Link2,
  Lock,
  Unlock,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type {
  EditablePath,
  EditablePoint,
  Selection,
  SegmentType,
  EditorAction,
  Layer,
  ImageLayer,
  ComponentInfo,
} from '@/lib/editorTypes';
import { computeClipboardData } from '@/hooks/useGlyphEditor';
import { setClipboard } from '@/lib/glyphClipboard';
import { computeSelectionBBox } from '@/hooks/useEditorInteraction';
import { getComponentAtPath } from '@/lib/svgPathParser';

/** Minimum x and y of all points in a path array (font-space Y-up). */
import type { TransformFeedback } from './GlyphEditorTab';

interface InspectorPanelProps {
  selection: Selection;
  paths: EditablePath[];
  dispatch: (action: EditorAction) => void;
  transformFeedback: TransformFeedback;
  layers: Layer[];
  activeLayerId: string;
  focusedLayerId: string;
  isComposite?: boolean;
  components?: ComponentInfo[];
  activeComponentPath?: number[];
}

interface Segment {
  pathId: string;
  startPointId: string;
  endPointId: string;
  startIndex: number;
  kind: 'line' | 'quad' | 'cubic';
  startPoint: EditablePoint;
  endPoint: EditablePoint;
  ctrl1?: EditablePoint;
  ctrl2?: EditablePoint;
}

interface SelectionInfo {
  points: EditablePoint[];
  pathIds: string[];
  segments: Segment[];
}

/** Single-pass collection of all selection data to avoid traversing paths 3×. */
function getSelectionInfo(paths: EditablePath[], selection: Selection): SelectionInfo {
  const points: EditablePoint[] = [];
  const pathIdSet = new Set<string>();
  const segments: Segment[] = [];

  for (const path of paths) {
    const cmds = path.commands;
    let lastOnCurve: EditablePoint | null = null;
    let firstOnCurve: EditablePoint | null = null;
    const isClosed = cmds[cmds.length - 1]?.kind === 'Z';

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];

      if (cmd.kind === 'M') {
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
          pathIdSet.add(path.id);
        }
        lastOnCurve = cmd.point;
        firstOnCurve = cmd.point;
      } else if (cmd.kind === 'L') {
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
          pathIdSet.add(path.id);
        }
        if (lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            segments.push({
              pathId: path.id,
              startPointId: lastOnCurve.id,
              endPointId: cmd.point.id,
              startIndex: i,
              kind: 'line',
              startPoint: lastOnCurve,
              endPoint: cmd.point,
            });
          }
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q') {
        if (selection.pointIds.has(cmd.ctrl.id)) {
          points.push(cmd.ctrl);
          pathIdSet.add(path.id);
        }
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
          pathIdSet.add(path.id);
        }
        if (lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            segments.push({
              pathId: path.id,
              startPointId: lastOnCurve.id,
              endPointId: cmd.point.id,
              startIndex: i,
              kind: 'quad',
              startPoint: lastOnCurve,
              endPoint: cmd.point,
              ctrl1: cmd.ctrl,
            });
          }
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C') {
        if (selection.pointIds.has(cmd.ctrl1.id)) {
          points.push(cmd.ctrl1);
          pathIdSet.add(path.id);
        }
        if (selection.pointIds.has(cmd.ctrl2.id)) {
          points.push(cmd.ctrl2);
          pathIdSet.add(path.id);
        }
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
          pathIdSet.add(path.id);
        }
        if (lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            segments.push({
              pathId: path.id,
              startPointId: lastOnCurve.id,
              endPointId: cmd.point.id,
              startIndex: i,
              kind: 'cubic',
              startPoint: lastOnCurve,
              endPoint: cmd.point,
              ctrl1: cmd.ctrl1,
              ctrl2: cmd.ctrl2,
            });
          }
        }
        lastOnCurve = cmd.point;
      }
    }

    // Handle closing segment in closed path
    if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
      const segmentId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
      if (selection.segmentIds.has(segmentId)) {
        segments.push({
          pathId: path.id,
          startPointId: lastOnCurve.id,
          endPointId: firstOnCurve.id,
          startIndex: cmds.length,
          kind: 'line',
          startPoint: lastOnCurve,
          endPoint: firstOnCurve,
        });
      }
    }
  }

  return { points, pathIds: Array.from(pathIdSet), segments };
}

function isPathClosed(path: EditablePath): boolean {
  return path.commands[path.commands.length - 1]?.kind === 'Z';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-b pb-3 last:mb-0 last:border-b-0 last:pb-0">
      <h4 className="text-muted-foreground mb-2 text-[10px] tracking-wide uppercase">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function Button({
  icon,
  label,
  active,
  onClick,
  disabled,
  shortcut,
}: {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={[
        'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted hover:bg-muted/80 text-foreground',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      {icon && <span className="h-3 w-3 flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] opacity-60">{shortcut}</span>}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          min={min}
          max={max}
          step={step}
          className="bg-background w-14 rounded border px-1.5 py-0.5 text-right font-mono text-xs"
        />
        {unit && <span className="text-muted-foreground text-[10px]">{unit}</span>}
      </div>
    </div>
  );
}

function ComponentTree({
  components,
  activePath,
  currentPath,
  onActivate,
  onToggleLock,
}: {
  components: ComponentInfo[];
  activePath: number[];
  currentPath: number[];
  onActivate: (path: number[]) => void;
  onToggleLock: (path: number[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  return (
    <div className="space-y-0.5">
      {components.map((comp, i) => {
        const itemPath = [...currentPath, i];
        const isActive =
          activePath.length === itemPath.length &&
          itemPath.every((v, idx) => v === activePath[idx]);
        const isExpanded = expanded.has(i);
        return (
          <div key={i}>
            <div
              className={[
                'flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-xs',
                isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
              ].join(' ')}
              onClick={() => {
                if (comp.isComposite) {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                } else {
                  onActivate(itemPath);
                }
              }}
            >
              {comp.isComposite ? (
                <span className="text-muted-foreground flex-shrink-0">
                  {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </span>
              ) : (
                <span className="w-2.5 flex-shrink-0" />
              )}
              <span className="text-muted-foreground flex-shrink-0">
                {comp.isComposite ? <Link2 size={11} /> : <PenLine size={11} />}
              </span>
              <span className="flex-1 truncate font-mono text-[10px]">#{comp.glyphId}</span>
              <button
                className="ml-auto flex-shrink-0 p-0.5 opacity-50 hover:opacity-100"
                title={
                  comp.locked
                    ? 'Locked: position only. Click to unlock for outline editing.'
                    : 'Unlocked: editing component outline. Click to lock.'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(itemPath);
                }}
              >
                {comp.locked ? <Lock size={10} /> : <Unlock size={10} />}
              </button>
            </div>
            {comp.isComposite && isExpanded && comp.subComponents.length > 0 && (
              <div className="border-muted ml-3 border-l pl-1">
                <ComponentTree
                  components={comp.subComponents}
                  activePath={activePath}
                  currentPath={itemPath}
                  onActivate={onActivate}
                  onToggleLock={onToggleLock}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function InspectorPanel({
  selection,
  paths,
  dispatch,
  transformFeedback,
  layers,
  focusedLayerId,
  isComposite = false,
  components = [],
  activeComponentPath = [],
}: InspectorPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compSnapshotRef = useRef<ComponentInfo[]>([]);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);

  const handleAddImageLayer = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const id = `img-${Date.now()}`;
      dispatch({
        type: 'ADD_IMAGE_LAYER',
        layer: {
          id,
          type: 'image',
          name: file.name,
          visible: true,
          imageDataUrl: dataUrl,
          opacity: 0.5,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          offsetX: 0,
          offsetY: 0,
        },
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddDrawingLayer = () => {
    const id = `layer-${Date.now()}`;
    dispatch({
      type: 'ADD_DRAWING_LAYER',
      layer: { id, type: 'drawing', name: `Layer ${layers.length}`, visible: true, paths: [] },
    });
  };

  const activeImageLayer = layers.find((l) => l.id === focusedLayerId && l.type === 'image') as
    | ImageLayer
    | undefined;
  const {
    points: selectedPoints,
    pathIds: selectedPathIds,
    segments: selectedSegments,
  } = getSelectionInfo(paths, selection);
  const selectedPath =
    selectedPathIds.length === 1 ? paths.find((p) => p.id === selectedPathIds[0]) : null;
  const hasSegmentSelected = selectedSegments.length > 0;
  const hasCurveSegment = selectedSegments.some((s) => s.kind === 'quad' || s.kind === 'cubic');

  const handleDeletePoints = () => {
    dispatch({ type: 'DELETE_SELECTED_POINTS' });
  };

  const handleCopyPoints = () => {
    const clipboardData = computeClipboardData(paths, selection);
    setClipboard(clipboardData);
  };

  const handleAddPointOnSegment = () => {
    if (selectedSegments.length === 0) return;
    const segment = selectedSegments[0];

    // For curves, add point at t=0.5 on the curve
    let x: number, y: number;
    if (segment.kind === 'line') {
      x = (segment.startPoint.x + segment.endPoint.x) / 2;
      y = (segment.startPoint.y + segment.endPoint.y) / 2;
    } else if (segment.kind === 'quad' && segment.ctrl1) {
      // Quadratic bezier at t=0.5
      const t = 0.5;
      const mt = 1 - t;
      x =
        mt * mt * segment.startPoint.x + 2 * mt * t * segment.ctrl1.x + t * t * segment.endPoint.x;
      y =
        mt * mt * segment.startPoint.y + 2 * mt * t * segment.ctrl1.y + t * t * segment.endPoint.y;
    } else if (segment.kind === 'cubic' && segment.ctrl1 && segment.ctrl2) {
      // Cubic bezier at t=0.5
      const t = 0.5;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;
      x =
        mt3 * segment.startPoint.x +
        3 * mt2 * t * segment.ctrl1.x +
        3 * mt * t2 * segment.ctrl2.x +
        t3 * segment.endPoint.x;
      y =
        mt3 * segment.startPoint.y +
        3 * mt2 * t * segment.ctrl1.y +
        3 * mt * t2 * segment.ctrl2.y +
        t3 * segment.endPoint.y;
    } else {
      return;
    }

    const newPoint: EditablePoint = {
      id: `pt-mid-${Date.now()}`,
      x,
      y,
      type: 'on-curve',
    };
    dispatch({
      type: 'ADD_POINT_ON_SEGMENT',
      pathId: segment.pathId,
      insertIndex: segment.startIndex,
      point: newPoint,
    });
  };

  const handleToggleClosed = () => {
    if (selectedPath) {
      dispatch({ type: 'TOGGLE_PATH_CLOSED', pathId: selectedPath.id });
    }
  };

  const handleReverseDirection = () => {
    if (selectedPath) {
      dispatch({ type: 'REVERSE_PATH_DIRECTION', pathId: selectedPath.id });
    }
  };

  const selectionBBox = computeSelectionBBox(paths, selection);
  const totalSelected = selection.pointIds.size + selection.segmentIds.size;
  const showTransformBox = totalSelected > 1 && selectionBBox;

  const [transformValues, setTransformValues] = useState({
    x: 0,
    y: 0,
    scaleX: 100,
    scaleY: 100,
    rotation: 0,
  });

  const lastSelectionKeyRef = useRef<string>('');
  const wasTransformActiveRef = useRef(false);
  const prevTransformValuesRef = useRef(transformValues);

  useEffect(() => {
    const selectionKey = `${Array.from(selection.pointIds).join(',')}:${Array.from(selection.segmentIds).join(',')}`;
    if (showTransformBox && selectionKey !== lastSelectionKeyRef.current) {
      lastSelectionKeyRef.current = selectionKey;
      const newValues = {
        x: Math.round((selectionBBox!.minX + selectionBBox!.maxX) / 2),
        y: Math.round((selectionBBox!.minY + selectionBBox!.maxY) / 2),
        scaleX: 100,
        scaleY: 100,
        rotation: 0,
      };
      setTransformValues(newValues);
      prevTransformValuesRef.current = newValues;
    }
  }, [showTransformBox, selectionBBox, selection.pointIds, selection.segmentIds]);

  useEffect(() => {
    if (wasTransformActiveRef.current && !transformFeedback.isActive && selectionBBox) {
      const newValues = {
        ...transformValues,
        x: Math.round((selectionBBox.minX + selectionBBox.maxX) / 2),
        y: Math.round((selectionBBox.minY + selectionBBox.maxY) / 2),
      };
      setTransformValues(newValues);
      prevTransformValuesRef.current = newValues;
    }
    wasTransformActiveRef.current = transformFeedback.isActive;
  }, [transformFeedback.isActive, selectionBBox, transformValues]);

  const applyTransform = useCallback(
    (newValues: typeof transformValues) => {
      if (!selectionBBox) return;

      const centerX = (selectionBBox.minX + selectionBBox.maxX) / 2;
      const centerY = (selectionBBox.minY + selectionBBox.maxY) / 2;

      const prev = prevTransformValuesRef.current;
      const deltaX = newValues.x - Math.round(centerX);
      const deltaY = newValues.y - Math.round(centerY);
      const deltaScaleX = newValues.scaleX / prev.scaleX;
      const deltaScaleY = newValues.scaleY / prev.scaleY;
      const deltaRotation = newValues.rotation - prev.rotation;

      if (
        deltaX === 0 &&
        deltaY === 0 &&
        deltaScaleX === 1 &&
        deltaScaleY === 1 &&
        deltaRotation === 0
      ) {
        return;
      }

      dispatch({
        type: 'APPLY_TRANSFORM',
        transform: {
          translateX: deltaX,
          translateY: deltaY,
          scaleX: deltaScaleX,
          scaleY: deltaScaleY,
          rotation: deltaRotation,
          centerX,
          centerY,
        },
        selection,
      });

      prevTransformValuesRef.current = newValues;
    },
    [selectionBBox, dispatch, selection]
  );

  return (
    <div className="bg-muted/20 w-44 shrink-0 overflow-y-auto border-l p-3 md:w-52 lg:w-56">
      <h3 className="mb-3 text-sm font-medium">Inspector</h3>

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAddImageLayer}
      />

      {/* Components (composite glyphs only) */}
      {isComposite && (
        <Section title="Components">
          {components.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">No components</p>
          ) : (
            <ComponentTree
              components={components}
              activePath={activeComponentPath}
              currentPath={[]}
              onActivate={(path) => dispatch({ type: 'SET_ACTIVE_COMPONENT', path })}
              onToggleLock={(path) => dispatch({ type: 'TOGGLE_COMPONENT_LOCK', path })}
            />
          )}
          {activeComponentPath.length > 0 &&
            (() => {
              const activeComp = getComponentAtPath(components, activeComponentPath);
              if (!activeComp) return null;
              // Use naturalXMin (hmtx LSB) and naturalYMin (outline bounds) stored on the component.
              const dispX = Math.round(activeComp.xOffset + activeComp.naturalXMin);
              const dispY = Math.round(activeComp.yOffset + activeComp.naturalYMin);
              return (
                <div className="mt-2 space-y-0.5 border-t pt-2">
                  <p className="text-muted-foreground mb-1 text-[10px]">
                    Position (Glyph #{activeComp.glyphId})
                  </p>
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-muted-foreground text-xs">X</span>
                    <input
                      type="number"
                      value={dispX}
                      step={1}
                      className="bg-background w-16 rounded border px-1.5 py-0.5 text-right font-mono text-xs"
                      onFocus={() => {
                        compSnapshotRef.current = JSON.parse(JSON.stringify(components));
                      }}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (isNaN(v)) return;
                        dispatch({
                          type: 'MOVE_COMPONENT_LIVE',
                          path: activeComponentPath,
                          dx: v - dispX,
                          dy: 0,
                        });
                      }}
                      onBlur={() =>
                        dispatch({
                          type: 'COMMIT_COMPONENT_MOVE',
                          path: activeComponentPath,
                          componentSnapshot: compSnapshotRef.current,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-muted-foreground text-xs">Y</span>
                    <input
                      type="number"
                      value={dispY}
                      step={1}
                      className="bg-background w-16 rounded border px-1.5 py-0.5 text-right font-mono text-xs"
                      onFocus={() => {
                        compSnapshotRef.current = JSON.parse(JSON.stringify(components));
                      }}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (isNaN(v)) return;
                        dispatch({
                          type: 'MOVE_COMPONENT_LIVE',
                          path: activeComponentPath,
                          dx: 0,
                          dy: v - dispY,
                        });
                      }}
                      onBlur={() =>
                        dispatch({
                          type: 'COMMIT_COMPONENT_MOVE',
                          path: activeComponentPath,
                          componentSnapshot: compSnapshotRef.current,
                        })
                      }
                    />
                  </div>
                </div>
              );
            })()}
        </Section>
      )}

      {/* Layers (non-composite glyphs only) */}
      {!isComposite && (
        <Section title="Layers">
          <div className="mb-2 space-y-0.5">
            {layers.map((layer) => (
              <div key={layer.id}>
                <div
                  className={[
                    'flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs',
                    layer.id === focusedLayerId ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  ].join(' ')}
                  onClick={() => {
                    if (layer.type === 'drawing')
                      dispatch({ type: 'SET_ACTIVE_LAYER', layerId: layer.id });
                    else dispatch({ type: 'SET_FOCUSED_LAYER', layerId: layer.id });
                  }}
                >
                  <button
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({
                        type: 'SET_LAYER_VISIBLE',
                        layerId: layer.id,
                        visible: !layer.visible,
                      });
                    }}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <span className="text-muted-foreground flex-shrink-0">
                    {layer.type === 'drawing' ? <PenLine size={12} /> : <ImageIcon size={12} />}
                  </span>
                  {renamingLayerId === layer.id ? (
                    <input
                      type="text"
                      defaultValue={layer.name}
                      autoFocus
                      className="bg-background border-primary min-w-0 flex-1 border-b px-0.5 py-0 text-xs outline-none"
                      onBlur={(e) => {
                        dispatch({ type: 'RENAME_LAYER', layerId: layer.id, name: e.target.value });
                        setRenamingLayerId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          dispatch({
                            type: 'RENAME_LAYER',
                            layerId: layer.id,
                            name: e.currentTarget.value,
                          });
                          setRenamingLayerId(null);
                        }
                        if (e.key === 'Escape') setRenamingLayerId(null);
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="flex-1 truncate"
                      onDoubleClick={() => {
                        if (layer.id !== 'outline') setRenamingLayerId(layer.id);
                      }}
                    >
                      {layer.name}
                    </span>
                  )}
                  {layer.id !== 'outline' && (
                    <button
                      className="text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'REMOVE_LAYER', layerId: layer.id });
                      }}
                      title="Remove layer"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Image layer settings (shown when focused) */}
                {layer.id === focusedLayerId && layer.type === 'image' && activeImageLayer && (
                  <div className="border-primary/20 mt-1 ml-2 space-y-0.5 border-l-2 pl-2">
                    <InputField
                      label="Opacity"
                      value={Math.round(activeImageLayer.opacity * 100)}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { opacity: Math.max(0, Math.min(1, v / 100)) },
                        })
                      }
                      unit="%"
                      min={0}
                      max={100}
                    />
                    <InputField
                      label="Scale X"
                      value={parseFloat(activeImageLayer.scaleX.toFixed(3))}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { scaleX: v },
                        })
                      }
                      step={0.1}
                    />
                    <InputField
                      label="Scale Y"
                      value={parseFloat(activeImageLayer.scaleY.toFixed(3))}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { scaleY: v },
                        })
                      }
                      step={0.1}
                    />
                    <InputField
                      label="Rotation"
                      value={parseFloat(activeImageLayer.rotation.toFixed(1))}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { rotation: v },
                        })
                      }
                      unit="°"
                    />
                    <InputField
                      label="Offset X"
                      value={Math.round(activeImageLayer.offsetX)}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { offsetX: v },
                        })
                      }
                    />
                    <InputField
                      label="Offset Y"
                      value={Math.round(activeImageLayer.offsetY)}
                      onChange={(v) =>
                        dispatch({
                          type: 'UPDATE_IMAGE_LAYER',
                          layerId: layer.id,
                          updates: { offsetY: v },
                        })
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleAddDrawingLayer}
              className="bg-muted hover:bg-muted/80 flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px]"
              title="Add drawing layer"
            >
              <PenLine size={10} /> Drawing
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-muted hover:bg-muted/80 flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10px]"
              title="Add image layer"
            >
              <ImageIcon size={10} /> Image
            </button>
          </div>
        </Section>
      )}

      {/* Transform Controls */}
      {showTransformBox && (
        <Section title="Transform">
          <InputField
            label="X"
            value={
              transformFeedback.isActive
                ? transformValues.x + Math.round(transformFeedback.deltaX)
                : transformValues.x
            }
            onChange={(v) => {
              const newValues = { ...transformValues, x: v };
              setTransformValues(newValues);
              applyTransform(newValues);
            }}
          />
          <InputField
            label="Y"
            value={
              transformFeedback.isActive
                ? transformValues.y + Math.round(transformFeedback.deltaY)
                : transformValues.y
            }
            onChange={(v) => {
              const newValues = { ...transformValues, y: v };
              setTransformValues(newValues);
              applyTransform(newValues);
            }}
          />
          <InputField
            label="Scale X"
            value={
              transformFeedback.isActive
                ? Math.round(transformFeedback.scaleX * 100)
                : transformValues.scaleX
            }
            onChange={(v) => {
              const newValues = { ...transformValues, scaleX: v };
              setTransformValues(newValues);
              applyTransform(newValues);
            }}
            unit="%"
            step={1}
          />
          <InputField
            label="Scale Y"
            value={
              transformFeedback.isActive
                ? Math.round(transformFeedback.scaleY * 100)
                : transformValues.scaleY
            }
            onChange={(v) => {
              const newValues = { ...transformValues, scaleY: v };
              setTransformValues(newValues);
              applyTransform(newValues);
            }}
            unit="%"
            step={1}
          />
          <InputField
            label="Rotation"
            value={
              transformFeedback.isActive
                ? Math.round(transformFeedback.rotation * 10) / 10
                : transformValues.rotation
            }
            onChange={(v) => {
              const newValues = { ...transformValues, rotation: v };
              setTransformValues(newValues);
              applyTransform(newValues);
            }}
            unit="°"
            step={1}
          />
        </Section>
      )}

      {/* Point Selection Info */}
      <Section title="Selected Points">
        {selectedPoints.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">No points selected</p>
        ) : (
          <>
            <Field label="Count" value={selectedPoints.length} />
            {selectedPoints.length === 1 && (
              <>
                <Field label="X" value={Math.round(selectedPoints[0].x)} />
                <Field label="Y" value={Math.round(selectedPoints[0].y)} />
                <Field label="Type" value={selectedPoints[0].type} />
              </>
            )}
            <div className="mt-2 space-y-1">
              <Button
                icon={<Copy size={12} />}
                label="Copy"
                onClick={handleCopyPoints}
                shortcut="Ctrl+C"
              />
              <Button
                icon={<X size={12} />}
                label="Delete"
                onClick={handleDeletePoints}
                shortcut="Del"
              />
            </div>
          </>
        )}
      </Section>

      {/* Segment Actions */}
      {hasSegmentSelected && (
        <Section title={hasCurveSegment ? 'Curve Segment' : 'Line Segment'}>
          <p className="text-muted-foreground mb-2 text-xs">
            {selectedSegments[0].kind === 'line' && 'Line'}
            {selectedSegments[0].kind === 'quad' && 'Quadratic Curve'}
            {selectedSegments[0].kind === 'cubic' && 'Cubic Curve'}: (
            {Math.round(selectedSegments[0].startPoint.x)},{' '}
            {Math.round(selectedSegments[0].startPoint.y)}) → (
            {Math.round(selectedSegments[0].endPoint.x)},{' '}
            {Math.round(selectedSegments[0].endPoint.y)})
          </p>
          <div className="space-y-1">
            <Button
              icon={<Plus size={12} />}
              label={hasCurveSegment ? 'Add Point on Curve' : 'Add Point on Line'}
              onClick={handleAddPointOnSegment}
            />
            {selectedSegments[0].kind === 'line' && (
              <>
                <Button
                  icon={<Spline size={12} />}
                  label="Convert to Quadratic"
                  onClick={() =>
                    dispatch({
                      type: 'CONVERT_SEGMENT_TO_CURVE',
                      segmentId: `${selectedSegments[0].pathId}:${selectedSegments[0].startPointId}:${selectedSegments[0].endPointId}`,
                      curveType: 'quadratic',
                    })
                  }
                />
                <Button
                  icon={<Spline size={12} />}
                  label="Convert to Cubic"
                  onClick={() =>
                    dispatch({
                      type: 'CONVERT_SEGMENT_TO_CURVE',
                      segmentId: `${selectedSegments[0].pathId}:${selectedSegments[0].startPointId}:${selectedSegments[0].endPointId}`,
                      curveType: 'cubic',
                    })
                  }
                />
              </>
            )}
          </div>
        </Section>
      )}

      {/* Path Info */}
      {selectedPath && (
        <Section title="Path">
          <Field label="Status" value={isPathClosed(selectedPath) ? 'Closed' : 'Open'} />
          <Field
            label="Points"
            value={selectedPath.commands.filter((c) => c.kind !== 'Z').length}
          />

          <div className="mt-2 space-y-1">
            <Button
              icon={isPathClosed(selectedPath) ? <X size={12} /> : <Circle size={12} />}
              label={isPathClosed(selectedPath) ? 'Open Path' : 'Close Path'}
              onClick={handleToggleClosed}
            />
            <Button
              icon={<RefreshCw size={12} />}
              label="Reverse Direction"
              onClick={handleReverseDirection}
            />
          </div>
        </Section>
      )}

      {/* Direction Info */}
      {selectedPath && (
        <Section title="Direction">
          <div className="flex gap-1">
            <Button icon={<ArrowUp size={12} />} label="CW" onClick={handleReverseDirection} />
            <Button icon={<ArrowDown size={12} />} label="CCW" onClick={handleReverseDirection} />
          </div>
          <p className="text-muted-foreground mt-2 text-[10px]">Click to reverse path direction</p>
        </Section>
      )}

      {/* Segment Type Conversion */}
      {selectedPoints.length === 1 && selectedPoints[0].type === 'on-curve' && (
        <Section title="Segment Type">
          <div className="flex gap-1">
            <Button
              label="Line"
              onClick={() =>
                dispatch({
                  type: 'CONVERT_SEGMENT_TYPE',
                  pointId: selectedPoints[0].id,
                  segmentType: 'line' as SegmentType,
                })
              }
            />
            <Button
              label="Curve"
              onClick={() =>
                dispatch({
                  type: 'CONVERT_SEGMENT_TYPE',
                  pointId: selectedPoints[0].id,
                  segmentType: 'curve' as SegmentType,
                })
              }
            />
          </div>
        </Section>
      )}

      {/* Handle Info */}
      {selectedPoints.length === 1 && selectedPoints[0].type.startsWith('off-curve') && (
        <Section title="Handle">
          <Field
            label="Type"
            value={selectedPoints[0].type === 'off-curve-quad' ? 'Quadratic' : 'Cubic'}
          />
          <Field label="X" value={Math.round(selectedPoints[0].x)} />
          <Field label="Y" value={Math.round(selectedPoints[0].y)} />
        </Section>
      )}

      {/* Keyboard Shortcuts Help */}
      <Section title="Shortcuts">
        <div className="text-muted-foreground space-y-1 text-[10px]">
          <p>
            <kbd className="bg-muted rounded px-1">Ctrl+C</kbd> Copy points
          </p>
          <p>
            <kbd className="bg-muted rounded px-1">Del</kbd> Delete points
          </p>
          <p>
            <kbd className="bg-muted rounded px-1">Ctrl+V</kbd> Paste points
          </p>
          <p>
            <kbd className="bg-muted rounded px-1">S</kbd> Select tool
          </p>
          <p>
            <kbd className="bg-muted rounded px-1">P</kbd> Pen tool
          </p>
        </div>
      </Section>
    </div>
  );
}
