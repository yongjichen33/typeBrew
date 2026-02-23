import { RefreshCw, X, Circle, Copy, Plus, ArrowUp, ArrowDown, Spline } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { EditablePath, EditablePoint, Selection, SegmentType, EditorAction } from '@/lib/editorTypes';
import { computeClipboardData } from '@/hooks/useGlyphEditor';
import { setClipboard } from '@/lib/glyphClipboard';
import { computeSelectionBBox } from '@/hooks/useEditorInteraction';
import type { TransformFeedback } from './GlyphEditorTab';

interface InspectorPanelProps {
  selection: Selection;
  paths: EditablePath[];
  dispatch: (action: EditorAction) => void;
  transformFeedback: TransformFeedback;
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

function getSelectedPoints(paths: EditablePath[], selection: Selection): EditablePoint[] {
  const points: EditablePoint[] = [];
  for (const path of paths) {
    for (const cmd of path.commands) {
      if (cmd.kind === 'M' || cmd.kind === 'L') {
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
        }
      } else if (cmd.kind === 'Q') {
        if (selection.pointIds.has(cmd.ctrl.id)) {
          points.push(cmd.ctrl);
        }
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
        }
      } else if (cmd.kind === 'C') {
        if (selection.pointIds.has(cmd.ctrl1.id)) {
          points.push(cmd.ctrl1);
        }
        if (selection.pointIds.has(cmd.ctrl2.id)) {
          points.push(cmd.ctrl2);
        }
        if (selection.pointIds.has(cmd.point.id)) {
          points.push(cmd.point);
        }
      }
    }
  }
  return points;
}

function getSelectedPathIds(paths: EditablePath[], selection: Selection): string[] {
  const pathIds = new Set<string>();
  for (const path of paths) {
    for (const cmd of path.commands) {
      if (cmd.kind === 'M' || cmd.kind === 'L') {
        if (selection.pointIds.has(cmd.point.id)) pathIds.add(path.id);
      } else if (cmd.kind === 'Q') {
        if (selection.pointIds.has(cmd.ctrl.id) || selection.pointIds.has(cmd.point.id)) {
          pathIds.add(path.id);
        }
      } else if (cmd.kind === 'C') {
        if (selection.pointIds.has(cmd.ctrl1.id) || selection.pointIds.has(cmd.ctrl2.id) || selection.pointIds.has(cmd.point.id)) {
          pathIds.add(path.id);
        }
      }
    }
  }
  return Array.from(pathIds);
}

function getSelectedSegments(paths: EditablePath[], selection: Selection): Segment[] {
  const segments: Segment[] = [];
  
  for (const path of paths) {
    const cmds = path.commands;
    let lastOnCurve: EditablePoint | null = null;
    
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      
      if (cmd.kind === 'M') {
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
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
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
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
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
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
        lastOnCurve = cmd.point;
      }
    }
  }
  
  return segments;
}

function isPathClosed(path: EditablePath): boolean {
  return path.commands[path.commands.length - 1]?.kind === 'Z';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-3 mb-3 last:border-b-0 last:pb-0 last:mb-0">
      <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono">{value}</span>
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
        'flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors w-full',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted hover:bg-muted/80 text-foreground',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {icon && <span className="w-3 h-3 flex-shrink-0">{icon}</span>}
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
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
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
          className="w-14 px-1.5 py-0.5 text-xs font-mono text-right bg-background border rounded"
        />
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export function InspectorPanel({
  selection,
  paths,
  dispatch,
  transformFeedback,
}: InspectorPanelProps) {
  const selectedPoints = getSelectedPoints(paths, selection);
  const selectedPathIds = getSelectedPathIds(paths, selection);
  const selectedPath = selectedPathIds.length === 1 
    ? paths.find(p => p.id === selectedPathIds[0]) 
    : null;
  const selectedSegments = getSelectedSegments(paths, selection);
  const hasSegmentSelected = selectedSegments.length > 0;
  const hasCurveSegment = selectedSegments.some(s => s.kind === 'quad' || s.kind === 'cubic');

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
      x = mt * mt * segment.startPoint.x + 2 * mt * t * segment.ctrl1.x + t * t * segment.endPoint.x;
      y = mt * mt * segment.startPoint.y + 2 * mt * t * segment.ctrl1.y + t * t * segment.endPoint.y;
    } else if (segment.kind === 'cubic' && segment.ctrl1 && segment.ctrl2) {
      // Cubic bezier at t=0.5
      const t = 0.5;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;
      x = mt3 * segment.startPoint.x + 3 * mt2 * t * segment.ctrl1.x + 3 * mt * t2 * segment.ctrl2.x + t3 * segment.endPoint.x;
      y = mt3 * segment.startPoint.y + 3 * mt2 * t * segment.ctrl1.y + 3 * mt * t2 * segment.ctrl2.y + t3 * segment.endPoint.y;
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
  const isApplyingTransformRef = useRef(false);
  
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

  const applyTransform = useCallback((newValues: typeof transformValues) => {
    if (!selectionBBox || isApplyingTransformRef.current) return;
    
    const centerX = (selectionBBox.minX + selectionBBox.maxX) / 2;
    const centerY = (selectionBBox.minY + selectionBBox.maxY) / 2;
    
    const prev = prevTransformValuesRef.current;
    const deltaX = newValues.x - (showTransformBox ? Math.round(centerX) : prev.x);
    const deltaY = newValues.y - (showTransformBox ? Math.round(centerY) : prev.y);
    const deltaScaleX = newValues.scaleX / prev.scaleX;
    const deltaScaleY = newValues.scaleY / prev.scaleY;
    const deltaRotation = newValues.rotation - prev.rotation;
    
    if (deltaX === 0 && deltaY === 0 && deltaScaleX === 1 && deltaScaleY === 1 && deltaRotation === 0) {
      return;
    }
    
    isApplyingTransformRef.current = true;
    
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
    
    setTimeout(() => {
      isApplyingTransformRef.current = false;
    }, 0);
  }, [selectionBBox, showTransformBox, dispatch, selection]);

  useEffect(() => {
    if (transformFeedback.isActive || isApplyingTransformRef.current) return;
    
    const prev = prevTransformValuesRef.current;
    const hasChanges = 
      transformValues.x !== prev.x ||
      transformValues.y !== prev.y ||
      transformValues.scaleX !== prev.scaleX ||
      transformValues.scaleY !== prev.scaleY ||
      transformValues.rotation !== prev.rotation;
    
    if (hasChanges && showTransformBox) {
      applyTransform(transformValues);
    }
  }, [transformValues, transformFeedback.isActive, showTransformBox, applyTransform]);

  return (
    <div className="w-56 border-l bg-muted/20 p-3 overflow-y-auto shrink-0">
      <h3 className="text-sm font-medium mb-3">Inspector</h3>

      {/* Transform Controls */}
      {showTransformBox && (
        <Section title="Transform">
          <InputField
            label="X"
            value={transformFeedback.isActive ? transformValues.x + Math.round(transformFeedback.deltaX) : transformValues.x}
            onChange={(v) => setTransformValues(prev => ({ ...prev, x: v }))}
          />
          <InputField
            label="Y"
            value={transformFeedback.isActive ? transformValues.y + Math.round(transformFeedback.deltaY) : transformValues.y}
            onChange={(v) => setTransformValues(prev => ({ ...prev, y: v }))}
          />
          <InputField
            label="Scale X"
            value={transformFeedback.isActive ? Math.round(transformFeedback.scaleX * 100) : transformValues.scaleX}
            onChange={(v) => setTransformValues(prev => ({ ...prev, scaleX: v }))}
            unit="%"
            step={1}
          />
          <InputField
            label="Scale Y"
            value={transformFeedback.isActive ? Math.round(transformFeedback.scaleY * 100) : transformValues.scaleY}
            onChange={(v) => setTransformValues(prev => ({ ...prev, scaleY: v }))}
            unit="%"
            step={1}
          />
          <InputField
            label="Rotation"
            value={transformFeedback.isActive ? Math.round(transformFeedback.rotation * 10) / 10 : transformValues.rotation}
            onChange={(v) => setTransformValues(prev => ({ ...prev, rotation: v }))}
            unit="°"
            step={1}
          />
        </Section>
      )}

      {/* Point Selection Info */}
      <Section title="Selected Points">
        {selectedPoints.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No points selected</p>
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
          <p className="text-xs text-muted-foreground mb-2">
            {selectedSegments[0].kind === 'line' && 'Line'}
            {selectedSegments[0].kind === 'quad' && 'Quadratic Curve'}
            {selectedSegments[0].kind === 'cubic' && 'Cubic Curve'}
            : ({Math.round(selectedSegments[0].startPoint.x)}, {Math.round(selectedSegments[0].startPoint.y)}) → ({Math.round(selectedSegments[0].endPoint.x)}, {Math.round(selectedSegments[0].endPoint.y)})
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
                  onClick={() => dispatch({ 
                    type: 'CONVERT_SEGMENT_TO_CURVE', 
                    segmentId: `${selectedSegments[0].pathId}:${selectedSegments[0].startPointId}:${selectedSegments[0].endPointId}`,
                    curveType: 'quadratic'
                  })}
                />
                <Button
                  icon={<Spline size={12} />}
                  label="Convert to Cubic"
                  onClick={() => dispatch({ 
                    type: 'CONVERT_SEGMENT_TO_CURVE', 
                    segmentId: `${selectedSegments[0].pathId}:${selectedSegments[0].startPointId}:${selectedSegments[0].endPointId}`,
                    curveType: 'cubic'
                  })}
                />
              </>
            )}
          </div>
        </Section>
      )}

      {/* Path Info */}
      {selectedPath && (
        <Section title="Path">
          <Field 
            label="Status" 
            value={isPathClosed(selectedPath) ? 'Closed' : 'Open'} 
          />
          <Field 
            label="Points" 
            value={selectedPath.commands.filter(c => c.kind !== 'Z').length} 
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
            <Button
              icon={<ArrowUp size={12} />}
              label="CW"
              onClick={handleReverseDirection}
            />
            <Button
              icon={<ArrowDown size={12} />}
              label="CCW"
              onClick={handleReverseDirection}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Click to reverse path direction
          </p>
        </Section>
      )}

      {/* Segment Type Conversion */}
      {selectedPoints.length === 1 && selectedPoints[0].type === 'on-curve' && (
        <Section title="Segment Type">
          <div className="flex gap-1">
            <Button
              label="Line"
              onClick={() => dispatch({ type: 'CONVERT_SEGMENT_TYPE', pointId: selectedPoints[0].id, segmentType: 'line' as SegmentType })}
            />
            <Button
              label="Curve"
              onClick={() => dispatch({ type: 'CONVERT_SEGMENT_TYPE', pointId: selectedPoints[0].id, segmentType: 'curve' as SegmentType })}
            />
          </div>
        </Section>
      )}

      {/* Handle Info */}
      {selectedPoints.length === 1 && selectedPoints[0].type.startsWith('off-curve') && (
        <Section title="Handle">
          <Field label="Type" value={selectedPoints[0].type === 'off-curve-quad' ? 'Quadratic' : 'Cubic'} />
          <Field label="X" value={Math.round(selectedPoints[0].x)} />
          <Field label="Y" value={Math.round(selectedPoints[0].y)} />
        </Section>
      )}

      {/* Keyboard Shortcuts Help */}
      <Section title="Shortcuts">
        <div className="text-[10px] text-muted-foreground space-y-1">
          <p><kbd className="px-1 bg-muted rounded">Ctrl+C</kbd> Copy points</p>
          <p><kbd className="px-1 bg-muted rounded">Del</kbd> Delete points</p>
          <p><kbd className="px-1 bg-muted rounded">Ctrl+V</kbd> Paste points</p>
          <p><kbd className="px-1 bg-muted rounded">S</kbd> Select tool</p>
          <p><kbd className="px-1 bg-muted rounded">P</kbd> Pen tool</p>
        </div>
      </Section>
    </div>
  );
}
