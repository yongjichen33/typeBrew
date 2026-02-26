export type ToolMode = 'pen' | 'node' | 'knife' | 'scale' | 'rotate' | 'skew' | 'hand';
export type SegmentType = 'line' | 'curve';
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

// ---- Layer types ----

/** A drawing layer containing editable bezier paths. */
export interface DrawingLayer {
  id: string;
  type: 'drawing';
  name: string;
  visible: boolean;
  /** Stored paths when this layer is NOT the active layer.
   *  When active, state.paths holds the working copy instead. */
  paths: EditablePath[];
}

/** A reference image layer rendered behind the drawing layers. */
export interface ImageLayer {
  id: string;
  type: 'image';
  name: string;
  visible: boolean;
  imageDataUrl: string;  // base64 data URL
  opacity: number;       // 0–1
  scaleX: number;        // 1 = 1 image px per font unit at vt.scale=1
  scaleY: number;
  rotation: number;      // degrees
  offsetX: number;       // font-space center X
  offsetY: number;       // font-space center Y
}

export type Layer = DrawingLayer | ImageLayer;

/** Font-level typographic metrics (all in font-space Y-up units). */
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  xHeight: number;
  capHeight: number;
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
  segmentIds: Set<string>; // Format: "pathId:startPointId:endPointId"
}

/** Rubber-band selection rect in screen pixels. */
export interface RubberBand {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ---- Editor state ----

export interface ClipboardData {
  points: EditablePoint[];
  segments: Array<{
    pathId: string;
    kind: 'L' | 'Q' | 'C';
    startPoint: EditablePoint;
    endPoint: EditablePoint;
    ctrl1?: EditablePoint;
    ctrl2?: EditablePoint;
  }>;
}

export interface EditorState {
  paths: EditablePath[];
  selection: Selection;
  toolMode: ToolMode;
  viewTransform: ViewTransform;
  isDirty: boolean;
  isSaving: boolean;
  undoStack: EditablePath[][];
  redoStack: EditablePath[][];
  showDirection: boolean;
  showCoordinates: boolean;
  activePathId: string | null;
  isDrawingPath: boolean;
  layers: Layer[];
  activeLayerId: string;
}

// ---- Actions ----

export type EditorAction =
  | { type: 'SET_PATHS'; paths: EditablePath[] }
  | { type: 'MOVE_POINTS_LIVE'; deltas: Map<string, Vec2> }
  | { type: 'COMMIT_MOVE'; snapshot: EditablePath[] }
  | { type: 'TRANSFORM_POINTS_LIVE'; deltas: Map<string, Vec2> }
  | { type: 'COMMIT_TRANSFORM'; snapshot: EditablePath[] }
  | { type: 'APPLY_TRANSFORM'; transform: { translateX?: number; translateY?: number; scaleX?: number; scaleY?: number; rotation?: number; centerX: number; centerY: number }; selection: Selection }
  | { type: 'ADD_POINT'; pathId: string; command: PathCommand }
  | { type: 'APPEND_TO_ACTIVE_PATH'; command: PathCommand }
  | { type: 'CLOSE_ACTIVE_PATH' }
  | { type: 'START_NEW_PATH'; path: EditablePath }
  | { type: 'SET_ACTIVE_PATH'; pathId: string | null }
  | { type: 'SET_DRAWING_STATE'; isDrawing: boolean }
  | { type: 'SET_SELECTION'; pointIds: Set<string>; segmentIds?: Set<string> }
  | { type: 'TOGGLE_SELECTION'; pointId: string }
  | { type: 'TOGGLE_SEGMENT_SELECTION'; segmentId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_TOOL_MODE'; mode: ToolMode }
  | { type: 'SET_VIEW_TRANSFORM'; vt: ViewTransform }
  | { type: 'CENTER_VIEW'; canvasWidth: number; canvasHeight: number; metrics: FontMetrics }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'MARK_SAVED' }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_SHOW_DIRECTION'; showDirection: boolean }
  | { type: 'SET_SHOW_COORDINATES'; showCoordinates: boolean }
  | { type: 'DELETE_SELECTED_POINTS' }
  | { type: 'PASTE_CLIPBOARD'; clipboard: ClipboardData; offsetX?: number; offsetY?: number }
  | { type: 'REVERSE_PATH_DIRECTION'; pathId: string }
  | { type: 'TOGGLE_PATH_CLOSED'; pathId: string }
  | { type: 'CONVERT_SEGMENT_TYPE'; pointId: string; segmentType: SegmentType }
  | { type: 'CONVERT_SEGMENT_TO_CURVE'; segmentId: string; curveType: 'quadratic' | 'cubic' }
  | { type: 'ADD_POINT_ON_SEGMENT'; pathId: string; insertIndex: number; point: EditablePoint }
  | { type: 'ADD_DRAWING_LAYER'; layer: DrawingLayer }
  | { type: 'ADD_IMAGE_LAYER'; layer: ImageLayer }
  | { type: 'REMOVE_LAYER'; layerId: string }
  | { type: 'SET_LAYER_VISIBLE'; layerId: string; visible: boolean }
  | { type: 'UPDATE_IMAGE_LAYER'; layerId: string; updates: Partial<Omit<ImageLayer, 'id' | 'type'>> }
  | { type: 'RENAME_LAYER'; layerId: string; name: string }
  | { type: 'SET_ACTIVE_LAYER'; layerId: string };

// ---- Context value ----

export interface GlyphEditorContextValue {
  /** Open a new editor tab for the given glyph. */
  openGlyphEditor: (glyphId: number) => void;
}

// ---- Glyph outline data from backend ----

export interface GlyphOutlinePoint {
  x: number;
  y: number;
}

export interface GlyphOutlineCommand {
  kind: 'M';
  point: GlyphOutlinePoint;
}

export interface GlyphOutlineCommandL {
  kind: 'L';
  point: GlyphOutlinePoint;
}

export interface GlyphOutlineCommandQ {
  kind: 'Q';
  ctrl: GlyphOutlinePoint;
  point: GlyphOutlinePoint;
}

export interface GlyphOutlineCommandC {
  kind: 'C';
  ctrl1: GlyphOutlinePoint;
  ctrl2: GlyphOutlinePoint;
  point: GlyphOutlinePoint;
}

export interface GlyphOutlineCommandZ {
  kind: 'Z';
}

export type GlyphOutlineCommandRaw =
  | GlyphOutlineCommand
  | GlyphOutlineCommandL
  | GlyphOutlineCommandQ
  | GlyphOutlineCommandC
  | GlyphOutlineCommandZ;

export interface GlyphContour {
  commands: GlyphOutlineCommandRaw[];
}

export interface GlyphOutlineData {
  glyph_id: number;
  glyph_name?: string;
  contours: GlyphContour[];
  advance_width: number;
  bounds?: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
  };
}

// ---- State passed to GoldenLayout for a GlyphEditorTab ----

export interface GlyphEditorTabState {
  filePath: string;
  tableName: string;
  glyphId: number;
  glyphName?: string;
  outlineData?: GlyphOutlineData;
  svgPath?: string;
  advanceWidth: number;
  boundsXMin: number;
  boundsYMin: number;
  boundsXMax: number;
  boundsYMax: number;
  unitsPerEm: number;
}
