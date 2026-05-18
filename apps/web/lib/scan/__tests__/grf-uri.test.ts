import { buildGrfUri, parseGrfUri } from '../grf-uri';

const GR_ID = '11111111-1111-1111-1111-111111111111';
const LINE_ID = '22222222-2222-2222-2222-222222222222';

describe('parseGrfUri', () => {
  it('parses minimal form (grId/lineId)', () => {
    const parsed = parseGrfUri(`GRF://${GR_ID}/${LINE_ID}`);
    expect(parsed).toEqual({ grId: GR_ID, lineId: LINE_ID, carton: undefined, qty: undefined });
  });

  it('parses with carton number', () => {
    const parsed = parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/3`);
    expect(parsed?.carton).toBe(3);
  });

  it('parses with qty query param', () => {
    const parsed = parseGrfUri(`GRF://${GR_ID}/${LINE_ID}?qty=5`);
    expect(parsed?.qty).toBe(5);
  });

  it('parses with both carton and qty', () => {
    const parsed = parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/2?qty=10`);
    expect(parsed).toEqual({ grId: GR_ID, lineId: LINE_ID, carton: 2, qty: 10 });
  });

  it('returns null for non-GRF strings (EAN-13 fournisseur)', () => {
    expect(parseGrfUri('1234567890123')).toBeNull();
    expect(parseGrfUri('https://www.merck.com/product/X')).toBeNull();
    expect(parseGrfUri('')).toBeNull();
  });

  it('returns null for malformed UUIDs', () => {
    expect(parseGrfUri('GRF://not-a-uuid/also-not')).toBeNull();
    expect(parseGrfUri(`GRF://${GR_ID}/short-id`)).toBeNull();
  });

  it('returns null for too many segments', () => {
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/3/extra`)).toBeNull();
  });

  it('returns null for out-of-range carton', () => {
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/0`)).toBeNull();
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/10000`)).toBeNull();
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}/abc`)).toBeNull();
  });

  it('returns null for out-of-range qty', () => {
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}?qty=0`)).toBeNull();
    expect(parseGrfUri(`GRF://${GR_ID}/${LINE_ID}?qty=abc`)).toBeNull();
  });

  it('trims whitespace before parsing', () => {
    const parsed = parseGrfUri(`  GRF://${GR_ID}/${LINE_ID}  `);
    expect(parsed?.grId).toBe(GR_ID);
  });

  it('handles non-string input gracefully', () => {
    // @ts-expect-error — vérifier le runtime check
    expect(parseGrfUri(null)).toBeNull();
    // @ts-expect-error
    expect(parseGrfUri(42)).toBeNull();
  });
});

describe('buildGrfUri', () => {
  it('builds minimal URI', () => {
    expect(buildGrfUri({ grId: GR_ID, lineId: LINE_ID })).toBe(`GRF://${GR_ID}/${LINE_ID}`);
  });

  it('appends carton', () => {
    expect(buildGrfUri({ grId: GR_ID, lineId: LINE_ID, carton: 4 })).toBe(
      `GRF://${GR_ID}/${LINE_ID}/4`,
    );
  });

  it('appends qty as query string', () => {
    expect(buildGrfUri({ grId: GR_ID, lineId: LINE_ID, qty: 3 })).toBe(
      `GRF://${GR_ID}/${LINE_ID}?qty=3`,
    );
  });

  it('round-trips through parse', () => {
    const uri = buildGrfUri({ grId: GR_ID, lineId: LINE_ID, carton: 7, qty: 2 });
    const parsed = parseGrfUri(uri);
    expect(parsed).toEqual({ grId: GR_ID, lineId: LINE_ID, carton: 7, qty: 2 });
  });
});
