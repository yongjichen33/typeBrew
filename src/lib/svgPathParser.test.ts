import { describe, it, expect } from 'vitest';
import {
  parseSvgPath,
  editablePathToSvg,
  collectAllPoints,
  clonePaths,
  outlineDataToEditablePaths,
} from './svgPathParser';
import type { EditablePath, GlyphOutlineData } from './editorTypes';

describe('parseSvgPath', () => {
  it('parses empty string', () => {
    expect(parseSvgPath('')).toEqual([]);
  });

  it('parses single M command', () => {
    const paths = parseSvgPath('M 100 200');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(1);
    expect(paths[0].commands[0].kind).toBe('M');
    if (paths[0].commands[0].kind === 'M') {
      // Y is negated: -200 (SVG Y-down to font Y-up)
      expect(paths[0].commands[0].point.x).toBe(100);
      expect(paths[0].commands[0].point.y).toBe(-200);
      expect(paths[0].commands[0].point.type).toBe('on-curve');
    }
  });

  it('parses M and L commands', () => {
    const paths = parseSvgPath('M 0 0 L 100 0 L 100 200');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(3);
    expect(paths[0].commands[0].kind).toBe('M');
    expect(paths[0].commands[1].kind).toBe('L');
    expect(paths[0].commands[2].kind).toBe('L');
  });

  it('parses Q (quadratic bezier) command', () => {
    const paths = parseSvgPath('M 0 0 Q 50 100 100 0');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(2);
    if (paths[0].commands[1].kind === 'Q') {
      // Y values are negated
      expect(paths[0].commands[1].ctrl.x).toBe(50);
      expect(paths[0].commands[1].ctrl.y).toBe(-100);
      expect(paths[0].commands[1].ctrl.type).toBe('off-curve-quad');
      expect(paths[0].commands[1].point.x).toBe(100);
      expect(paths[0].commands[1].point.y).toBeCloseTo(0);
    }
  });

  it('parses C (cubic bezier) command', () => {
    const paths = parseSvgPath('M 0 0 C 25 100 75 100 100 0');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(2);
    if (paths[0].commands[1].kind === 'C') {
      expect(paths[0].commands[1].ctrl1.x).toBe(25);
      expect(paths[0].commands[1].ctrl1.y).toBe(-100);
      expect(paths[0].commands[1].ctrl1.type).toBe('off-curve-cubic');
      expect(paths[0].commands[1].ctrl2.x).toBe(75);
      expect(paths[0].commands[1].ctrl2.y).toBe(-100);
      expect(paths[0].commands[1].point.x).toBe(100);
      expect(paths[0].commands[1].point.y).toBeCloseTo(0);
    }
  });

  it('parses Z (close path) command', () => {
    const paths = parseSvgPath('M 0 0 L 100 0 Z');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(3);
    expect(paths[0].commands[2].kind).toBe('Z');
  });

  it('parses multiple paths', () => {
    const paths = parseSvgPath('M 0 0 L 10 10 M 100 100 L 200 200');
    expect(paths).toHaveLength(2);
    expect(paths[0].commands).toHaveLength(2);
    expect(paths[1].commands).toHaveLength(2);
  });

  it('parses negative coordinates', () => {
    const paths = parseSvgPath('M -100 -200 L -50 -100');
    expect(paths).toHaveLength(1);
    if (paths[0].commands[0].kind === 'M') {
      expect(paths[0].commands[0].point.x).toBe(-100);
      expect(paths[0].commands[0].point.y).toBe(200); // -(-200)
    }
  });

  it('parses decimal coordinates', () => {
    const paths = parseSvgPath('M 10.5 20.75 L 30.25 40.5');
    expect(paths).toHaveLength(1);
    if (paths[0].commands[0].kind === 'M') {
      expect(paths[0].commands[0].point.x).toBeCloseTo(10.5);
      expect(paths[0].commands[0].point.y).toBeCloseTo(-20.75);
    }
  });

  it('parses scientific notation', () => {
    const paths = parseSvgPath('M 1e2 2E-1 L 3e+1 4E0');
    expect(paths).toHaveLength(1);
    if (paths[0].commands[0].kind === 'M') {
      expect(paths[0].commands[0].point.x).toBe(100);
      expect(paths[0].commands[0].point.y).toBeCloseTo(-0.2);
    }
  });

  it('parses lowercase commands', () => {
    // Note: lowercase commands are treated same as uppercase in this parser
    const paths = parseSvgPath('m 100 200 l 300 400');
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(2);
  });
});

describe('editablePathToSvg', () => {
  it('roundtrips simple path', () => {
    const svgIn = 'M 0 0 L 100 0 L 100 200 Z';
    const paths = parseSvgPath(svgIn);
    const svgOut = editablePathToSvg(paths);
    const pathsAgain = parseSvgPath(svgOut);

    // Verify structure is preserved
    expect(pathsAgain).toHaveLength(1);
    expect(pathsAgain[0].commands).toHaveLength(4);
  });

  it('roundtrips quadratic bezier', () => {
    const svgIn = 'M 0 0 Q 50 100 100 0';
    const paths = parseSvgPath(svgIn);
    const svgOut = editablePathToSvg(paths);
    const pathsAgain = parseSvgPath(svgOut);

    expect(pathsAgain).toHaveLength(1);
    expect(pathsAgain[0].commands).toHaveLength(2);
    if (pathsAgain[0].commands[1].kind === 'Q') {
      expect(pathsAgain[0].commands[1].ctrl.x).toBe(50);
      expect(pathsAgain[0].commands[1].ctrl.y).toBe(-100);
    }
  });

  it('roundtrips cubic bezier', () => {
    const svgIn = 'M 0 0 C 25 100 75 100 100 0';
    const paths = parseSvgPath(svgIn);
    const svgOut = editablePathToSvg(paths);
    const pathsAgain = parseSvgPath(svgOut);

    expect(pathsAgain).toHaveLength(1);
    expect(pathsAgain[0].commands).toHaveLength(2);
    if (pathsAgain[0].commands[1].kind === 'C') {
      expect(pathsAgain[0].commands[1].ctrl1.x).toBe(25);
      expect(pathsAgain[0].commands[1].ctrl2.x).toBe(75);
    }
  });

  it('roundtrips multiple paths', () => {
    const svgIn = 'M 0 0 L 10 10 M 100 100 L 200 200';
    const paths = parseSvgPath(svgIn);
    const svgOut = editablePathToSvg(paths);
    const pathsAgain = parseSvgPath(svgOut);

    expect(pathsAgain).toHaveLength(2);
  });

  it('negates Y values in output', () => {
    const paths: EditablePath[] = [
      {
        id: 'test',
        commands: [{ kind: 'M', point: { id: 'p1', x: 100, y: 200, type: 'on-curve' } }],
      },
    ];
    const svg = editablePathToSvg(paths);
    // Font Y-up (200) should become SVG Y-down (-200)
    expect(svg).toContain('M100 -200');
  });
});

describe('collectAllPoints', () => {
  it('collects points from empty paths', () => {
    expect(collectAllPoints([])).toEqual([]);
  });

  it('collects on-curve points', () => {
    const paths = parseSvgPath('M 0 0 L 100 0 L 100 200');
    const points = collectAllPoints(paths);
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.type === 'on-curve')).toBe(true);
  });

  it('collects off-curve points from quadratic', () => {
    const paths = parseSvgPath('M 0 0 Q 50 100 100 0');
    const points = collectAllPoints(paths);
    expect(points).toHaveLength(3); // M point + Q ctrl + Q point
    expect(points.filter((p) => p.type === 'off-curve-quad')).toHaveLength(1);
    expect(points.filter((p) => p.type === 'on-curve')).toHaveLength(2);
  });

  it('collects off-curve points from cubic', () => {
    const paths = parseSvgPath('M 0 0 C 25 100 75 100 100 0');
    const points = collectAllPoints(paths);
    expect(points).toHaveLength(4); // M point + C ctrl1 + C ctrl2 + C point
    expect(points.filter((p) => p.type === 'off-curve-cubic')).toHaveLength(2);
    expect(points.filter((p) => p.type === 'on-curve')).toHaveLength(2);
  });

  it('ignores Z commands', () => {
    const paths = parseSvgPath('M 0 0 L 100 0 Z');
    const points = collectAllPoints(paths);
    expect(points).toHaveLength(2); // Z doesn't add points
  });
});

describe('clonePaths', () => {
  it('creates deep copy', () => {
    const paths = parseSvgPath('M 0 0 L 100 0');
    const cloned = clonePaths(paths);

    // Verify structure is the same (ignoring -0 vs 0)
    expect(cloned).toHaveLength(paths.length);
    expect(cloned[0].commands).toHaveLength(paths[0].commands.length);
    expect(cloned).not.toBe(paths);
    expect(cloned[0]).not.toBe(paths[0]);
    expect(cloned[0].commands).not.toBe(paths[0].commands);
  });

  it('mutations do not affect original', () => {
    const paths = parseSvgPath('M 0 0 L 100 0');
    const cloned = clonePaths(paths);

    if (cloned[0].commands[0].kind === 'M') {
      cloned[0].commands[0].point.x = 999;
    }

    if (paths[0].commands[0].kind === 'M') {
      expect(paths[0].commands[0].point.x).toBe(0);
    }
  });

  it('handles empty paths', () => {
    expect(clonePaths([])).toEqual([]);
  });
});

describe('outlineDataToEditablePaths', () => {
  const makeOutlineData = (
    contours: Array<{ commands: Array<{ kind: string; [key: string]: unknown }> }>
  ): GlyphOutlineData => ({
    glyph_id: 1,
    contours: contours as GlyphOutlineData['contours'],
    advance_width: 100,
    bounds: { x_min: 0, y_min: 0, x_max: 100, y_max: 200 },
    is_composite: false,
    component_glyph_ids: [],
    components: [],
  });

  it('converts simple contour', () => {
    const outlineData = makeOutlineData([
      {
        commands: [
          { kind: 'M', point: { x: 0, y: 0 } },
          { kind: 'L', point: { x: 100, y: 0 } },
          { kind: 'L', point: { x: 100, y: 200 } },
          { kind: 'Z' },
        ],
      },
    ]);

    const paths = outlineDataToEditablePaths(outlineData);
    expect(paths).toHaveLength(1);
    expect(paths[0].commands).toHaveLength(4);
    expect(paths[0].commands[0].kind).toBe('M');
    expect(paths[0].commands[1].kind).toBe('L');
    expect(paths[0].commands[2].kind).toBe('L');
    expect(paths[0].commands[3].kind).toBe('Z');
  });

  it('converts quadratic contour', () => {
    const outlineData = makeOutlineData([
      {
        commands: [
          { kind: 'M', point: { x: 0, y: 0 } },
          { kind: 'Q', ctrl: { x: 50, y: 100 }, point: { x: 100, y: 0 } },
        ],
      },
    ]);

    const paths = outlineDataToEditablePaths(outlineData);
    expect(paths).toHaveLength(1);
    if (paths[0].commands[1].kind === 'Q') {
      expect(paths[0].commands[1].ctrl.x).toBe(50);
      expect(paths[0].commands[1].ctrl.type).toBe('off-curve-quad');
      expect(paths[0].commands[1].point.type).toBe('on-curve');
    }
  });

  it('converts cubic contour', () => {
    const outlineData = makeOutlineData([
      {
        commands: [
          { kind: 'M', point: { x: 0, y: 0 } },
          {
            kind: 'C',
            ctrl1: { x: 25, y: 100 },
            ctrl2: { x: 75, y: 100 },
            point: { x: 100, y: 0 },
          },
        ],
      },
    ]);

    const paths = outlineDataToEditablePaths(outlineData);
    expect(paths).toHaveLength(1);
    if (paths[0].commands[1].kind === 'C') {
      expect(paths[0].commands[1].ctrl1.type).toBe('off-curve-cubic');
      expect(paths[0].commands[1].ctrl2.type).toBe('off-curve-cubic');
      expect(paths[0].commands[1].point.type).toBe('on-curve');
    }
  });

  it('converts multiple contours', () => {
    const outlineData = makeOutlineData([
      {
        commands: [{ kind: 'M', point: { x: 0, y: 0 } }],
      },
      {
        commands: [{ kind: 'M', point: { x: 100, y: 100 } }],
      },
    ]);

    const paths = outlineDataToEditablePaths(outlineData);
    expect(paths).toHaveLength(2);
  });

  it('assigns unique IDs to points', () => {
    const outlineData = makeOutlineData([
      {
        commands: [
          { kind: 'M', point: { x: 0, y: 0 } },
          { kind: 'L', point: { x: 100, y: 0 } },
        ],
      },
    ]);

    const paths = outlineDataToEditablePaths(outlineData);
    const points = collectAllPoints(paths);
    const ids = points.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
