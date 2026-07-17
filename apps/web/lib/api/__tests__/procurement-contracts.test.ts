/**
 * US-075 (F-S8-21 / F-S8-22) — contrats front↔API : les corps envoyés
 * doivent satisfaire les DTO Zod STRICTS côté API (l'audit v2 a montré
 * deux actions en 400 systématique à cause de corps désalignés).
 */
import { acknowledgePurchaseOrder, updateGrLine } from '../procurement';

const fetchMock = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
  json: async () => ({}),
  text: async () => '',
});
global.fetch = fetchMock as unknown as typeof fetch;

function lastBody(): unknown {
  const call = fetchMock.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(call[1].body);
}

describe('contrats procurement (US-075)', () => {
  beforeEach(() => fetchMock.mockClear());

  it('acknowledgePurchaseOrder envoie { ackRef } (DTO AcknowledgePoDto strict)', async () => {
    await acknowledgePurchaseOrder('po-1', 'ACK-2026-01', { accessToken: 't' });
    expect(lastBody()).toEqual({ ackRef: 'ACK-2026-01' });
  });

  it('updateGrLine enveloppe la ligne dans { lines: [...] } (DTO UpdateGrLinesDto strict)', async () => {
    await updateGrLine('gr-1', { lineId: 'l1', quantity: 5, batchNumber: 'B1' }, { accessToken: 't' });
    expect(lastBody()).toEqual({ lines: [{ lineId: 'l1', quantity: 5, batchNumber: 'B1' }] });
  });
});
