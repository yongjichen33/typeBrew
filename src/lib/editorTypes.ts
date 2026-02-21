export type ToolMode = 'select' | 'draw';
export type DrawPointType = 'on-curve' | 'off-curve';
export type PointType = 'on-curve' | 'off-curve-quad' | 'off-curve-cubic';

export interface Vec2 {
  x: number;
  y: number;
}

/** A single point in font-space (Y-up coordinate system). */
export interface EditablePoint {
  id: string;
  x: number;
  y: number;
  type: PointType;
}

/** A single command in a contour path (font-space Y-up). */
export type PathCommand =
  | { kind: 'M'; point: EditablePoint }
  | { kind: 'L'; point: EditablePoint }
  | { kind: 'Q'; ctrl: EditablePoint; point: EditablePoint }
  | { kind: 'C'; ctrl1: EditablePoint; ctrl2: EditablePoint; point: EditablePoint }
  | { kind: 'Z' };

/** A contour (one continuous path, possibly closed with Z). */
export interface EditablePath {
  id: string;
  commands: PathCommand[];
}

/** Font-level typographic metrics (all in font-space Y-up units). */
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  advanceWidth: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** Maps font-space coordinates to canvas pixels.
 *  screenX = originX + fontX * scale
 *  screenY = originY - fontY * scale   (Y-flip)
 */
export interface ViewTransform {
  scale: number;
  originX: number;
  originY: number;
}

/** Currently selected point IDs. */
export interface Selection {
  pointIds: Set<string>;
}

/** Rubber-band selection rect in screen pixels. */
export interface RubberBand {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ---- Editor state ----

export interface EditorState {
  paths: EditablePath[];
  selection: Selection;
  toolMode: ToolMode;
  drawPointType: DrawPointType;
  viewTransform: ViewTransform;
  isDirty: boolean;
  isSaving: boolean;
  undoStack: EditablePath[][];
  redoStack: EditablePath[][];
}

// ---- Actions ----

export type EditorAction =
  | { type: 'SET_PATHS'; paths: EditablePath[] }
  | { type: 'MOVE_POINTS'; deltas: Map<string, Vec2> }
  | { type: 'ADD_POINT'; pathId: string; command: PathCommand }
  | { type: 'SET_SELECTION'; pointIds: Set<string> }
  | { type: 'TOGGLE_SELECTION'; pointId: string }
  | { type: 'SET_TOOL_MODE'; mode: ToolMode }
  | { type: 'SET_DRAW_POINT_TYPE'; drawPointType: DrawPointType }
  | { type: 'SET_VIEW_TRANSFORM'; vt: ViewTransform }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'MARK_SAVED' }
  | { type: 'SET_SAVING'; saving: boolean };

// ---- Context value ----

export interface GlyphEditorContextValue {
  /** Open a new editor tab for the given glyph. */
  openGlyphEditor: (glyphId: number) => void;
}

// ---- State passed to GoldenLayout for a GlyphEditorTab ----

export interface GlyphEditorTabState {
  filePath: string;
  tableName: string;
  glyphId: number;
  glyphName?: string;
  svgPath: string;
  advanceWidth: number;
  boundsXMin: number;
  boundsYMin: number;
  boundsXMax: number;
  boundsYMax: number;
  unitsPerEm: number;
}
