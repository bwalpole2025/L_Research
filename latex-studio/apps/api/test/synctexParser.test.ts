import { describe, expect, it } from 'vitest';
import { parseSynctexView, parseSynctexEdit } from '../src/compile/synctexParser.js';

const VIEW_OUTPUT = `This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:main.pdf
Page:1
x:155.997009
y:684.299011
h:142.262009
v:678.708008
W:329.003448
H:11.187561
before:
offset:0
middle:
after:
Page:2
x:100.0
y:200.0
h:90.0
v:210.0
W:300.0
H:12.0
SyncTeX result end
`;

const EDIT_OUTPUT = `This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:main.pdf
Input:/workspace/proj123/chapters/intro.tex
Line:42
Column:-1
Offset:0
Context:
SyncTeX result end
`;

describe('parseSynctexView (forward)', () => {
  it('parses every Page record with its box', () => {
    const records = parseSynctexView(VIEW_OUTPUT);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ page: 1, h: 142.262009, v: 678.708008, W: 329.003448 });
    expect(records[0]?.H).toBeCloseTo(11.187561, 3);
    expect(records[1]?.page).toBe(2);
  });

  it('returns nothing for empty output', () => {
    expect(parseSynctexView('SyncTeX result begin\nSyncTeX result end\n')).toEqual([]);
  });
});

describe('parseSynctexEdit (inverse)', () => {
  it('parses the input file, line and column', () => {
    const r = parseSynctexEdit(EDIT_OUTPUT);
    expect(r).toEqual({ file: '/workspace/proj123/chapters/intro.tex', line: 42, column: -1 });
  });

  it('returns null when there is no result', () => {
    expect(parseSynctexEdit('This is SyncTeX command line utility, version 1.5\n')).toBeNull();
  });
});
