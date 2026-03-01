import type {
  EditablePath,
  EditablePoint,
  PathCommand,
  GlyphOutlineData,
  BackendComponentOffset,
  ComponentInfo,
  PointType,
} from './editorTypes';

let _idCounter = 0;
function uid(): string {
  return `pt-${++_idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Parse an SVG path string into editable contours.
 *
 * The backend writes path data with Y negated (y_svg = -y_font) so that the
 * path renders correctly in an SVG element with a standard top-left origin.
 * We negate Y here to get back to font-space Y-up coordinates.
 *
 * Supported commands: M, L, Q, C, Z (absolute, as produced by the backend).
 */
export function parseSvgPath(svgPath: string): EditablePath[] {
  const tokens = svgPath.match(/[MLQCZmlqcz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];

  const paths: EditablePath[] = [];
  let commands: PathCommand[] | null = null;
  let i = 0;

  const num = (): number => parseFloat(tokens[i++]);
  // Negate Y: the backend stores -y_font, so y_font = -y_svg
  const yflip = (): number => -num();

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M':
      case 'm': {
        if (commands !== null) {
          paths.push({ id: uid(), commands });
        }
        commands = [];
        const x = num(),
          y = yflip();
        const pt: EditablePoint = { id: uid(), x, y, type: 'on-curve' };
        commands.push({ kind: 'M', point: pt });
        break;
      }
      case 'L':
      case 'l': {
        if (!commands) break;
        const x = num(),
          y = yflip();
        const pt: EditablePoint = { id: uid(), x, y, type: 'on-curve' };
        commands.push({ kind: 'L', point: pt });
        break;
      }
      case 'Q':
      case 'q': {
        if (!commands) break;
        const cx = num(),
          cy = yflip();
        const x = num(),
          y = yflip();
        commands.push({
          kind: 'Q',
          ctrl: { id: uid(), x: cx, y: cy, type: 'off-curve-quad' },
          point: { id: uid(), x, y, type: 'on-curve' },
        });
        break;
      }
      case 'C':
      case 'c': {
        if (!commands) break;
        const cx1 = num(),
          cy1 = yflip();
        const cx2 = num(),
          cy2 = yflip();
        const x = num(),
          y = yflip();
        commands.push({
          kind: 'C',
          ctrl1: { id: uid(), x: cx1, y: cy1, type: 'off-curve-cubic' },
          ctrl2: { id: uid(), x: cx2, y: cy2, type: 'off-curve-cubic' },
          point: { id: uid(), x, y, type: 'on-curve' },
        });
        break;
      }
      case 'Z':
      case 'z': {
        if (!commands) break;
        commands.push({ kind: 'Z' });
        break;
      }
    }
  }

  if (commands !== null) {
    paths.push({ id: uid(), commands });
  }

  return paths;
}

/**
 * Serialize editable paths back to the SVG path string format expected by
 * the backend — Y values are negated (y_svg = -y_font) to match the original
 * encoding from the backend's SvgPathPen.
 */
export function editablePathToSvg(paths: EditablePath[]): string {
  const parts: string[] = [];

  for (const path of paths) {
    for (const cmd of path.commands) {
      switch (cmd.kind) {
        case 'M':
          parts.push(`M${cmd.point.x} ${-cmd.point.y}`);
          break;
        case 'L':
          parts.push(`L${cmd.point.x} ${-cmd.point.y}`);
          break;
        case 'Q':
          parts.push(`Q${cmd.ctrl.x} ${-cmd.ctrl.y} ${cmd.point.x} ${-cmd.point.y}`);
          break;
        case 'C':
          parts.push(
            `C${cmd.ctrl1.x} ${-cmd.ctrl1.y} ${cmd.ctrl2.x} ${-cmd.ctrl2.y} ${cmd.point.x} ${-cmd.point.y}`
          );
          break;
        case 'Z':
          parts.push('Z');
          break;
      }
    }
  }

  return parts.join(' ');
}

/** Collect all editable points from a set of paths (for hit testing, rendering). */
export function collectAllPoints(paths: EditablePath[]): EditablePoint[] {
  const pts: EditablePoint[] = [];
  for (const path of paths) {
    for (const cmd of path.commands) {
      if (cmd.kind === 'M' || cmd.kind === 'L') pts.push(cmd.point);
      else if (cmd.kind === 'Q') {
        pts.push(cmd.ctrl, cmd.point);
      } else if (cmd.kind === 'C') {
        pts.push(cmd.ctrl1, cmd.ctrl2, cmd.point);
      }
    }
  }
  return pts;
}

/** Deep-clone paths (for undo stack). */
export function clonePaths(paths: EditablePath[]): EditablePath[] {
  return JSON.parse(JSON.stringify(paths));
}

/** Convert GlyphOutlineData from backend to EditablePath[] for the editor. */
export function outlineDataToEditablePaths(outlineData: GlyphOutlineData): EditablePath[] {
  return outlineData.contours.map((contour, contourIndex) => {
    const commands: PathCommand[] = contour.commands.map((cmd) => {
      switch (cmd.kind) {
        case 'M':
          return {
            kind: 'M' as const,
            point: makePoint(cmd.point.x, cmd.point.y, 'on-curve'),
          };
        case 'L':
          return {
            kind: 'L' as const,
            point: makePoint(cmd.point.x, cmd.point.y, 'on-curve'),
          };
        case 'Q':
          return {
            kind: 'Q' as const,
            ctrl: makePoint(cmd.ctrl.x, cmd.ctrl.y, 'off-curve-quad'),
            point: makePoint(cmd.point.x, cmd.point.y, 'on-curve'),
          };
        case 'C':
          return {
            kind: 'C' as const,
            ctrl1: makePoint(cmd.ctrl1.x, cmd.ctrl1.y, 'off-curve-cubic'),
            ctrl2: makePoint(cmd.ctrl2.x, cmd.ctrl2.y, 'off-curve-cubic'),
            point: makePoint(cmd.point.x, cmd.point.y, 'on-curve'),
          };
        case 'Z':
          return { kind: 'Z' as const };
      }
    });
    return { id: `contour-${contourIndex}-${uid()}`, commands };
  });
}

function makePoint(x: number, y: number, type: PointType): EditablePoint {
  return { id: uid(), x, y, type };
}

/**
 * Convert backend ComponentOffset[] (with recursively nested outlines) into
 * the ComponentInfo[] tree used by the editor.
 */
export function buildComponentInfoTree(
  backendComponents: BackendComponentOffset[]
): ComponentInfo[] {
  return backendComponents.map((c) => ({
    glyphId: c.glyph_id,
    xOffset: c.x_offset,
    yOffset: c.y_offset,
    paths: c.outline ? outlineDataToEditablePaths(c.outline) : [],
    isComposite: c.outline?.is_composite ?? false,
    subComponents: c.outline?.components ? buildComponentInfoTree(c.outline.components) : [],
  }));
}

/** Walk a ComponentInfo tree following the given index path. */
export function getComponentAtPath(
  components: ComponentInfo[],
  path: number[]
): ComponentInfo | null {
  let current = components;
  let result: ComponentInfo | null = null;
  for (const idx of path) {
    if (idx < 0 || idx >= current.length) return null;
    result = current[idx];
    current = result.subComponents;
  }
  return result;
}

/** Immutably update a component at the given path using an updater function. */
export function updateComponentAtPath(
  components: ComponentInfo[],
  path: number[],
  updater: (c: ComponentInfo) => ComponentInfo
): ComponentInfo[] {
  if (path.length === 0) return components;
  const [head, ...rest] = path;
  return components.map((c, i) => {
    if (i !== head) return c;
    if (rest.length === 0) return updater(c);
    return { ...c, subComponents: updateComponentAtPath(c.subComponents, rest, updater) };
  });
}

/** Flatten the component tree into a flat array of { glyph_id, x_offset, y_offset }. */
export function flattenComponentOffsets(
  components: ComponentInfo[]
): Array<{ glyph_id: number; x_offset: number; y_offset: number }> {
  const result: Array<{ glyph_id: number; x_offset: number; y_offset: number }> = [];
  for (const c of components) {
    result.push({ glyph_id: c.glyphId, x_offset: c.xOffset, y_offset: c.yOffset });
    // Note: only top-level components are stored in the composite glyph record.
    // Sub-components are stored in each component's own glyph.
  }
  return result;
}
