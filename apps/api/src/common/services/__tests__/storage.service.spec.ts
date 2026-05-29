/**
 * Sprint F-DEPLOY-CLOUD — tests du routing R2 / S3 + compat MinIO.
 *
 * On mocke `minio.Client` pour vérifier sans réseau :
 *  - construction depuis MINIO_* (dev legacy) et S3_* (cloud)
 *  - parsing S3_ENDPOINT (URL → host/port/ssl)
 *  - routing single-bucket : putObject/getObject vers le bucket physique
 *    avec préfixage clé par le bucket logique
 *  - skipAutoCreate quand S3_BUCKET est set
 */

import type { ConfigService } from '@nestjs/config';

// Mock du SDK minio. Capture les arguments du constructeur + des appels.
const ctorSpy = jest.fn();
const bucketExistsMock = jest.fn();
const makeBucketMock = jest.fn();
const putObjectMock = jest.fn().mockResolvedValue({ etag: 'e' });
const statObjectMock = jest.fn();
const getObjectMock = jest.fn();
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation((opts: unknown) => {
    ctorSpy(opts);
    return {
      bucketExists: bucketExistsMock,
      makeBucket: makeBucketMock,
      putObject: putObjectMock,
      statObject: statObjectMock,
      getObject: getObjectMock,
    };
  }),
}));

// Importé APRÈS jest.mock pour que la mock s'applique.
import { StorageService } from '../storage.service';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(k: string): T | undefined => env[k] as T | undefined,
  } as unknown as ConfigService;
}

beforeEach(() => {
  ctorSpy.mockClear();
  bucketExistsMock.mockReset().mockResolvedValue(true);
  makeBucketMock.mockReset();
  putObjectMock.mockClear();
  statObjectMock.mockReset();
  getObjectMock.mockReset();
});

describe('StorageService — mode dev (MinIO multi-bucket)', () => {
  it('construit le client depuis MINIO_* (host/port/ssl/access/secret)', () => {
    new StorageService(
      makeConfig({
        MINIO_HOST: 'minio.local',
        MINIO_PORT: '9000',
        MINIO_USE_SSL: 'false',
        MINIO_ACCESS_KEY: 'A',
        MINIO_SECRET_KEY: 'S',
      }),
    );
    const opts = ctorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.endPoint).toBe('minio.local');
    expect(opts.port).toBe(9000);
    expect(opts.useSSL).toBe(false);
    expect(opts.accessKey).toBe('A');
    expect(opts.secretKey).toBe('S');
  });

  it('ensureBucket crée le bucket si absent (auto-create activé)', async () => {
    const svc = new StorageService(makeConfig({}));
    bucketExistsMock.mockResolvedValue(false);
    await svc.ensureBucket('grantflow-invoices');
    expect(makeBucketMock).toHaveBeenCalledWith('grantflow-invoices');
  });

  it('putObject route vers le bucket logique tel quel + clé inchangée', async () => {
    const svc = new StorageService(makeConfig({}));
    await svc.putObject({
      bucket: 'grantflow-invoices',
      objectKey: 'invoices/2026/05/abc.pdf',
      buffer: Buffer.from('PDF'),
      contentType: 'application/pdf',
    });
    expect(putObjectMock).toHaveBeenCalledWith(
      'grantflow-invoices',
      'invoices/2026/05/abc.pdf',
      expect.any(Buffer),
      3,
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
  });
});

describe('StorageService — mode cloud (S3_BUCKET single-bucket)', () => {
  const cloudConfig = makeConfig({
    S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    S3_ACCESS_KEY: 'rA',
    S3_SECRET_KEY: 'rS',
    S3_REGION: 'auto',
    S3_BUCKET: 'grantflow-pdf',
  });

  it('parse S3_ENDPOINT → host + port 443 + useSSL=true', () => {
    new StorageService(cloudConfig);
    const opts = ctorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.endPoint).toBe('account.r2.cloudflarestorage.com');
    expect(opts.port).toBe(443);
    expect(opts.useSSL).toBe(true);
    expect(opts.region).toBe('auto');
    expect(opts.accessKey).toBe('rA');
    expect(opts.secretKey).toBe('rS');
  });

  it('S3_ENDPOINT invalide → exception explicite', () => {
    expect(
      () =>
        new StorageService(
          makeConfig({ S3_ENDPOINT: 'pas-une-url', S3_BUCKET: 'b' }),
        ),
    ).toThrow(/Invalid S3_ENDPOINT/);
  });

  it('ensureBucket = no-op (skipAutoCreate en mode cloud)', async () => {
    const svc = new StorageService(cloudConfig);
    await svc.ensureBucket('grantflow-invoices');
    expect(bucketExistsMock).not.toHaveBeenCalled();
    expect(makeBucketMock).not.toHaveBeenCalled();
  });

  it('putObject route vers S3_BUCKET avec clé préfixée par bucket logique', async () => {
    const svc = new StorageService(cloudConfig);
    const res = await svc.putObject({
      bucket: 'grantflow-invoices',
      objectKey: 'invoices/2026/05/abc.pdf',
      buffer: Buffer.from('PDF'),
      contentType: 'application/pdf',
    });
    expect(putObjectMock).toHaveBeenCalledWith(
      'grantflow-pdf',
      'grantflow-invoices/invoices/2026/05/abc.pdf',
      expect.any(Buffer),
      3,
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
    // L'API publique renvoie le bucket/key LOGIQUES — la persistance
    // applicative ignore le routing single-bucket.
    expect(res).toEqual({
      bucket: 'grantflow-invoices',
      objectKey: 'invoices/2026/05/abc.pdf',
    });
  });

  it('getObject lit depuis S3_BUCKET avec la clé préfixée', async () => {
    statObjectMock.mockResolvedValue({ size: 3, metaData: { 'content-type': 'application/pdf' } });
    // Simule un stream qui émet "PDF" puis end.
    const { EventEmitter } = await import('events');
    const stream = new EventEmitter();
    getObjectMock.mockResolvedValue(stream);
    const svc = new StorageService(cloudConfig);
    const p = svc.getObject('grantflow-pos', 'pos/2026/05/x.pdf');
    process.nextTick(() => {
      stream.emit('data', Buffer.from('PDF'));
      stream.emit('end');
    });
    const result = await p;
    expect(statObjectMock).toHaveBeenCalledWith('grantflow-pdf', 'grantflow-pos/pos/2026/05/x.pdf');
    expect(getObjectMock).toHaveBeenCalledWith('grantflow-pdf', 'grantflow-pos/pos/2026/05/x.pdf');
    expect(result.size).toBe(3);
  });

  it('S3_REGION non défini → fallback "us-east-1"', () => {
    new StorageService(
      makeConfig({
        S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
        S3_ACCESS_KEY: 'a',
        S3_SECRET_KEY: 's',
        S3_BUCKET: 'b',
      }),
    );
    const opts = ctorSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.region).toBe('us-east-1');
  });
});
