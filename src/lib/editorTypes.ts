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
  readonly id: string;
  x: number;
  y: number;
  readonly type: PointType;
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
  imageDataUrl: string; // base64 data URL
  opacity: number; // 0–1
  scaleX: number; // 1 = 1 image px per font unit at vt.scale=1
  scaleY: number;
  rotation: number; // degrees
  offsetX: number; // font-space center X
  offsetY: number; // font-space center Y
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
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
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

/** A component of a composite glyph, with its own outline and positional offset. */
export interface ComponentInfo {
  glyphId: number;
  xOffset: number;
  yOffset: number;
  /** Outline paths in font-space (Y-up). Empty for pure composite components. */
  paths: EditablePath[];
  /** True when this component is itself a composite. */
  isComposite: boolean;
  /** Recursively populated when isComposite is true. */
  subComponents: ComponentInfo[];
  /** true = position-only editing; false = full outline editing. Default: true. */
  locked: boolean;
  /** Left side bearing of this component glyph (from hmtx). Used for position display. */
  naturalXMin: number;
  /** Bottom edge (yMin) of this component glyph's outline bounding box. */
  naturalYMin: number;
}

/** One entry in the undo/redo stack. component moves also snapshot the components tree. */
export interface HistoryEntry {
  paths: EditablePath[];
  /** Present only for component-offset moves; absent for normal path edits. */
  components?: ComponentInfo[];
}

export interface EditorState {
  paths: EditablePath[];
  selection: Selection;
  toolMode: ToolMode;
  viewTransform: ViewTransform;
  isDirty: boolean;
  isSaving: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  showDirection: boolean;
  showCoordinates: boolean;
  activePathId: string | null;
  isDrawingPath: boolean;
  layers: Layer[];
  activeLayerId: string;
  focusedLayerId: string;
  /** True after a multi-point drag completes; reset when selection changes. */
  showTransformBox: boolean;
  /** Show a unit-grid in the background behind the glyph outline. */
  showPixelGrid: boolean;
  /** Show the filled glyph preview panel at the bottom of the canvas. */
  showPreview: boolean;
  /** Invert preview colors (white glyph on black background). */
  previewInverted: boolean;
  /** Height of the preview panel in pixels. */
  previewHeight: number;
  /** True if this glyph is a composite (references other glyphs). */
  isComposite: boolean;
  /** Full component tree (only populated when isComposite is true). */
  components: ComponentInfo[];
  /** Path of indices through the component tree to the active component. [] = none active. */
  activeComponentPath: number[];
  /** True if the font contains hinting data (TrueType or CFF). */
  isHinted: boolean;
  /** The hinting format detected: 'truetype', 'cff', or null. */
  hintFormat: 'truetype' | 'cff' | null;
  /** True when the hinting preview panel is shown. */
  showHinting: boolean;
}

// ---- Actions ----

export type EditorAction =
  | {
      type: 'SET_PATHS';
      paths: EditablePath[];
      isComposite?: boolean;
      components?: ComponentInfo[];
    }
  | { type: 'SET_ACTIVE_COMPONENT'; path: number[] }
  | { type: 'UPDATE_COMPONENT_PATHS'; path: number[]; paths: EditablePath[] }
  | { type: 'MOVE_COMPONENT_LIVE'; path: number[]; dx: number; dy: number }
  | { type: 'COMMIT_COMPONENT_MOVE'; path: number[]; componentSnapshot: ComponentInfo[] }
  | { type: 'TOGGLE_COMPONENT_LOCK'; path: number[] }
  | { type: 'MOVE_POINTS_LIVE'; deltas: Map<string, Vec2> }
  | { type: 'COMMIT_MOVE'; snapshot: HistoryEntry }
  | { type: 'TRANSFORM_POINTS_LIVE'; deltas: Map<string, Vec2> }
  | { type: 'COMMIT_TRANSFORM'; snapshot: HistoryEntry }
  | {
      type: 'APPLY_TRANSFORM';
      transform: {
        translateX?: number;
        translateY?: number;
        scaleX?: number;
        scaleY?: number;
        rotation?: number;
        centerX: number;
        centerY: number;
      };
      selection: Selection;
    }
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
  | { type: 'SET_SHOW_PIXEL_GRID'; showPixelGrid: boolean }
  | { type: 'SET_SHOW_PREVIEW'; showPreview: boolean }
  | { type: 'SET_PREVIEW_INVERTED'; previewInverted: boolean }
  | { type: 'SET_PREVIEW_HEIGHT'; previewHeight: number }
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
  | {
      type: 'UPDATE_IMAGE_LAYER';
      layerId: string;
      updates: Partial<Omit<ImageLayer, 'id' | 'type'>>;
    }
  | { type: 'RENAME_LAYER'; layerId: string; name: string }
  | { type: 'SET_ACTIVE_LAYER'; layerId: string }
  | { type: 'SET_FOCUSED_LAYER'; layerId: string }
  | {
      type: 'CONNECT_WITH_LINE';
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      /** If set, extend this existing open path with L(toX,toY) instead of creating a new M+L sub-path. */
      extendSourcePathId?: string;
      /** If set, insert a new point on a segment before creating the connecting path. */
      insertInSegment?: {
        pathId: string;
        insertIndex: number;
        newPointId: string;
        newPointX: number;
        newPointY: number;
      };
    }
  | {
      /** Connect two open path endpoints without creating any new point objects.
       *  - If target is the first point of sourcePathId → close that path.
       *  - If target is first/last point of a different open path → merge the two paths.
       */
      type: 'CONNECT_PATH_ENDPOINTS';
      sourcePathId: string;
      targetPointId: string;
    }
  | { type: 'SET_HINTING_INFO'; isHinted: boolean; hintFormat: 'truetype' | 'cff' | null }
  | { type: 'SET_SHOW_HINTING'; showHinting: boolean };

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

/** Raw component data as sent from the Rust backend (snake_case). */
export interface BackendComponentOffset {
  glyph_id: number;
  x_offset: number;
  y_offset: number;
  outline?: GlyphOutlineData;
}

export interface GlyphOutlineData {
  glyph_id: number;
  glyph_name?: string;
  contours: GlyphContour[];
  advance_width: number;
  /** Left side bearing from hmtx table (font-space units). */
  lsb?: number;
  bounds?: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
  };
  is_composite: boolean;
  component_glyph_ids: number[];
  components: BackendComponentOffset[];
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
