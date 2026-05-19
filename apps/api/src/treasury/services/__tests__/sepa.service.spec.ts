import { SepaService, type SepaPayload } from '../sepa.service';
import { SepaGenerationFailedException } from '../../../common/exceptions/business.exception';

function makePayload(overrides: Partial<SepaPayload> = {}): SepaPayload {
  return {
    messageId: 'PAY-2026-0001',
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    executionDate: new Date('2026-05-20'),
    debtor: {
      name: 'Institut Pasteur de Dakar',
      iban: 'SN08SN0010010000000000000001',
      bic: 'ECOCSNDA',
    },
    transactions: [
      {
        endToEndId: 'PAY-2026-0001-001',
        amount: '485000.00',
        currency: 'XOF',
        creditor: {
          name: 'Thermo Fisher Scientific',
          iban: 'FR7630006000011234567890189',
          bic: 'AGRIFRPP',
        },
        remittanceInfo: 'Facture F-2026-001',
      },
    ],
    ...overrides,
  };
}

describe('SepaService', () => {
  const svc = new SepaService();

  describe('generate', () => {
    it('emits valid pain.001.001.03 XML structure', () => {
      const xml = svc.generate(makePayload());
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
      expect(xml).toContain('<CstmrCdtTrfInitn>');
      expect(xml).toContain('<MsgId>PAY-2026-0001</MsgId>');
      expect(xml).toContain('<NbOfTxs>1</NbOfTxs>');
      expect(xml).toContain('<CtrlSum>485000.00</CtrlSum>');
    });

    it('writes debtor IBAN/BIC', () => {
      const xml = svc.generate(makePayload());
      expect(xml).toContain('<IBAN>SN08SN0010010000000000000001</IBAN>');
      expect(xml).toContain('<BIC>ECOCSNDA</BIC>');
    });

    it('writes one CdtTrfTxInf per transaction', () => {
      const xml = svc.generate(
        makePayload({
          transactions: [
            {
              endToEndId: 'E1',
              amount: '1000.00',
              currency: 'EUR',
              creditor: { name: 'A', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP' },
              remittanceInfo: 'F-001',
            },
            {
              endToEndId: 'E2',
              amount: '2500.50',
              currency: 'EUR',
              creditor: { name: 'B', iban: 'FR7610010101010101010101010', bic: 'BNPAFRPP' },
              remittanceInfo: 'F-002',
            },
          ],
        }),
      );
      const txCount = (xml.match(/<CdtTrfTxInf>/g) ?? []).length;
      expect(txCount).toBe(2);
      expect(xml).toContain('<EndToEndId>E1</EndToEndId>');
      expect(xml).toContain('<EndToEndId>E2</EndToEndId>');
      // CtrlSum = 1000 + 2500.50 = 3500.50
      expect(xml).toContain('<CtrlSum>3500.50</CtrlSum>');
    });

    it('encodes currency on each InstdAmt (multidevises supported)', () => {
      const xml = svc.generate(
        makePayload({
          transactions: [
            {
              endToEndId: 'E1',
              amount: '500.00',
              currency: 'EUR',
              creditor: { name: 'A', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP' },
              remittanceInfo: 'F-001',
            },
            {
              endToEndId: 'E2',
              amount: '750.00',
              currency: 'USD',
              creditor: { name: 'B', iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2L' },
              remittanceInfo: 'F-002',
            },
          ],
        }),
      );
      expect(xml).toContain('<InstdAmt Ccy="EUR">500.00</InstdAmt>');
      expect(xml).toContain('<InstdAmt Ccy="USD">750.00</InstdAmt>');
    });

    it('strips whitespace from IBANs', () => {
      const xml = svc.generate(
        makePayload({
          debtor: {
            name: 'IPD',
            iban: 'SN08 SN00 1001 0000 0000 0000 0001',
            bic: 'ECOCSNDA',
          },
        }),
      );
      expect(xml).toContain('<IBAN>SN08SN0010010000000000000001</IBAN>');
    });

    it('truncates remittance info to 140 chars (SEPA limit)', () => {
      const longRef = 'X'.repeat(200);
      const xml = svc.generate(
        makePayload({
          transactions: [
            {
              endToEndId: 'E1',
              amount: '100.00',
              currency: 'XOF',
              creditor: { name: 'A', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP' },
              remittanceInfo: longRef,
            },
          ],
        }),
      );
      const match = xml.match(/<Ustrd>(.*?)<\/Ustrd>/);
      expect(match).not.toBeNull();
      expect(match![1].length).toBe(140);
    });

    it('throws SepaGenerationFailed if transactions empty', () => {
      expect(() => svc.generate(makePayload({ transactions: [] }))).toThrow(
        SepaGenerationFailedException,
      );
    });

    it('throws if debtor IBAN missing', () => {
      const payload = makePayload();
      payload.debtor.iban = '';
      expect(() => svc.generate(payload)).toThrow(SepaGenerationFailedException);
    });

    it('throws if creditor BIC missing', () => {
      const payload = makePayload();
      payload.transactions[0].creditor.bic = '';
      expect(() => svc.generate(payload)).toThrow(SepaGenerationFailedException);
    });

    it('emits standard PmtMtd=TRF + SvcLvl=SEPA + ChrgBr=SLEV', () => {
      const xml = svc.generate(makePayload());
      expect(xml).toContain('<PmtMtd>TRF</PmtMtd>');
      expect(xml).toContain('<Cd>SEPA</Cd>');
      expect(xml).toContain('<ChrgBr>SLEV</ChrgBr>');
    });
  });

  describe('validateStructure', () => {
    it('returns valid=true for a well-formed XML', () => {
      const xml = svc.generate(makePayload());
      const res = svc.validateStructure(xml);
      expect(res.valid).toBe(true);
      expect(res.missing).toEqual([]);
    });

    it('returns invalid + missing list for an empty string', () => {
      const res = svc.validateStructure('<root/>');
      expect(res.valid).toBe(false);
      expect(res.missing.length).toBeGreaterThan(0);
    });
  });
});
