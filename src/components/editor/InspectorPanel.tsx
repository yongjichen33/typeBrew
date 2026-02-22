import { RefreshCw, X, Circle, Copy, Plus, ArrowUp, ArrowDown } from 'lucide-react';
import type { EditablePath, EditablePoint, Selection, SegmentType } from '@/lib/editorTypes';

interface InspectorPanelProps {
  selection: Selection;
  paths: EditablePath[];
  dispatch: (action: unknown) => void;
}

interface Segment {
  pathId: string;
  startPointId: string;
  endPointId: string;
  startIndex: number;
  kind: 'line' | 'quad' | 'cubic';
  startPoint: EditablePoint;
  endPoint: EditablePoint;
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

function getSelectedLineSegments(paths: EditablePath[], selection: Selection): Segment[] {
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
      } else if (cmd.kind === 'Q') {
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C') {
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

export function InspectorPanel({
  selection,
  paths,
  dispatch,
}: InspectorPanelProps) {
  const selectedPoints = getSelectedPoints(paths, selection);
  const selectedPathIds = getSelectedPathIds(paths, selection);
  const selectedPath = selectedPathIds.length === 1 
    ? paths.find(p => p.id === selectedPathIds[0]) 
    : null;
  const selectedLineSegments = getSelectedLineSegments(paths, selection);
  const hasLineSelected = selectedLineSegments.length > 0;

  const handleDeletePoints = () => {
    dispatch({ type: 'DELETE_SELECTED_POINTS' });
  };

  const handleCopyPoints = () => {
    dispatch({ type: 'COPY_SELECTED_POINTS' });
  };

  const handleAddPointOnLine = () => {
    if (selectedLineSegments.length === 0) return;
    const segment = selectedLineSegments[0];
    const midX = (segment.startPoint.x + segment.endPoint.x) / 2;
    const midY = (segment.startPoint.y + segment.endPoint.y) / 2;
    const newPoint: EditablePoint = {
      id: `pt-mid-${Date.now()}`,
      x: midX,
      y: midY,
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

  return (
    <div className="w-56 border-l bg-muted/20 p-3 overflow-y-auto shrink-0">
      <h3 className="text-sm font-medium mb-3">Inspector</h3>

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

      {/* Line Segment Actions */}
      {hasLineSelected && (
        <Section title="Line Segment">
          <p className="text-xs text-muted-foreground mb-2">
            Line selected: ({Math.round(selectedLineSegments[0].startPoint.x)}, {Math.round(selectedLineSegments[0].startPoint.y)}) → ({Math.round(selectedLineSegments[0].endPoint.x)}, {Math.round(selectedLineSegments[0].endPoint.y)})
          </p>
          <Button
            icon={<Plus size={12} />}
            label="Add Point on Line"
            onClick={handleAddPointOnLine}
          />
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
          <p><kbd className="px-1 bg-muted rounded">P</kbd> Pen tool</p>
          <p><kbd className="px-1 bg-muted rounded">N</kbd> Node tool</p>
        </div>
      </Section>
    </div>
  );
}
