import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

export interface PutObjectArgs {
  bucket: string;
  objectKey: string;
  buffer: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  buffer: Buffer;
  contentType: string;
  size: number;
}

/**
 * Service de stockage objet — MinIO en dev, S3-compatible en prod
 * (Cloudflare R2, AWS S3, Wasabi, Backblaze B2…).
 *
 * ## Buckets *logiques*
 * Les callers parlent de buckets logiques (constantes) :
 *   grantflow-pos       PDFs des bons de commande
 *   grantflow-invoices  PDFs des factures
 *   grantflow-reports   livrables bailleurs
 *
 * ## Modes
 * - **Dev local (MinIO)** : variables `MINIO_HOST` / `MINIO_PORT` / `MINIO_USE_SSL`
 *   / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`. Chaque bucket logique est un
 *   bucket réel (créé à la demande via `ensureBucket`).
 * - **Cloud (R2/S3)** : variables `S3_ENDPOINT` (URL complète, ex.
 *   `https://<acc>.r2.cloudflarestorage.com`) / `S3_ACCESS_KEY` /
 *   `S3_SECRET_KEY` / `S3_REGION` (R2 = `auto`) / `S3_BUCKET` (UN seul
 *   bucket physique, ex. `grantflow-pdf`). En présence de `S3_BUCKET`, le
 *   service active le **routing single-bucket** : tous les objets sont
 *   stockés dans `S3_BUCKET` avec la clé préfixée par le nom du bucket
 *   logique (`grantflow-invoices/invoices/2026/05/x.pdf`). Le caller ne
 *   voit RIEN — ni les constantes ni les chemins métier ne changent.
 *
 * ## Pourquoi single-bucket en cloud ?
 * Sur R2 (free tier), créer 3 buckets via UI/API est fastidieux ; un seul
 * bucket avec prefixes simplifie le setup utilisateur sans recompiler.
 * On désactive l'auto-create en mode cloud (le bucket est créé une fois
 * via le dashboard ; le compte API n'a pas forcément la permission
 * d'admin pour `makeBucket`).
 *
 * Path-style URLs : le SDK Minio les utilise par défaut, ce qui est
 * compatible avec R2 (et requis pour beaucoup d'endpoints S3-compatibles
 * non-AWS). Aucune option `forcePathStyle` n'est nécessaire ici.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Minio.Client;
  private readonly endPoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;
  /** Bucket physique unique en mode cloud, null en mode dev (un bucket par usage). */
  private readonly singleBucket: string | null;
  /** En mode cloud, on ne tente pas de créer les buckets (admin requis). */
  private readonly skipAutoCreate: boolean;

  constructor(private readonly config: ConfigService) {
    // -------- Endpoint / credentials --------
    // 1) Mode cloud : S3_ENDPOINT (URL complète) prioritaire.
    // 2) Mode dev   : MINIO_HOST + MINIO_PORT + MINIO_USE_SSL legacy.
    const s3Endpoint = this.config.get<string>('S3_ENDPOINT');
    if (s3Endpoint && s3Endpoint.trim().length > 0) {
      try {
        const url = new URL(s3Endpoint);
        this.endPoint = url.hostname;
        this.useSSL = url.protocol === 'https:';
        // Port : explicit dans l'URL, sinon 443 (https) ou 80 (http).
        this.port = url.port
          ? parseInt(url.port, 10)
          : this.useSSL
            ? 443
            : 80;
      } catch (e) {
        throw new Error(
          `Invalid S3_ENDPOINT "${s3Endpoint}" — must be a full URL like https://account.r2.cloudflarestorage.com. ${
            e instanceof Error ? e.message : ''
          }`,
        );
      }
    } else {
      this.endPoint = this.config.get<string>('MINIO_HOST') ?? 'localhost';
      this.port = parseInt(this.config.get<string>('MINIO_PORT') ?? '9000', 10);
      this.useSSL = this.config.get<string>('MINIO_USE_SSL') === 'true';
    }

    const accessKey =
      this.config.get<string>('S3_ACCESS_KEY') ??
      this.config.get<string>('MINIO_ACCESS_KEY') ??
      'minioadmin';
    const secretKey =
      this.config.get<string>('S3_SECRET_KEY') ??
      this.config.get<string>('MINIO_SECRET_KEY') ??
      'minioadmin';
    // Région : "us-east-1" par défaut (MinIO l'accepte) ; sur R2 mettre
    // "auto" via S3_REGION dans l'env de prod.
    const region = this.config.get<string>('S3_REGION') ?? 'us-east-1';

    this.client = new Minio.Client({
      endPoint: this.endPoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey,
      secretKey,
      region,
    });

    // -------- Routing single-bucket (mode cloud) --------
    const sb = this.config.get<string>('S3_BUCKET');
    this.singleBucket = sb && sb.trim().length > 0 ? sb.trim() : null;
    this.skipAutoCreate = this.singleBucket !== null; // cloud => bucket déjà créé via dashboard

    this.logger.log(
      {
        endPoint: this.endPoint,
        port: this.port,
        useSSL: this.useSSL,
        region,
        mode: this.singleBucket ? 'cloud-single-bucket' : 'dev-multi-bucket',
        singleBucket: this.singleBucket ?? null,
      },
      'storage client init',
    );
  }

  async onModuleInit(): Promise<void> {
    // Pas de bootstrap : on crée à la demande (mode dev) ou rien (mode cloud).
  }

  /**
   * Crée le bucket physique s'il n'existe pas. En mode cloud, no-op
   * silencieux — le bucket est censé exister (créé via dashboard).
   */
  async ensureBucket(logicalBucket: string): Promise<void> {
    if (this.skipAutoCreate) return;
    const target = this.resolveBucket(logicalBucket);
    const exists = await this.client.bucketExists(target);
    if (!exists) {
      await this.client.makeBucket(target);
      this.logger.log({ bucket: target }, 'bucket created');
    }
  }

  async putObject(args: PutObjectArgs): Promise<{ objectKey: string; bucket: string }> {
    await this.ensureBucket(args.bucket);
    const target = this.resolveBucket(args.bucket);
    const key = this.resolveKey(args.bucket, args.objectKey);
    const metaData = {
      'Content-Type': args.contentType ?? 'application/octet-stream',
      ...(args.metadata ?? {}),
    };
    await this.client.putObject(target, key, args.buffer, args.buffer.length, metaData);
    this.logger.log(
      { bucket: args.bucket, key: args.objectKey, physicalKey: key, size: args.buffer.length },
      'object uploaded',
    );
    // On renvoie la clé/bucket LOGIQUE — la persistance applicative n'a pas
    // à connaître le routing single-bucket.
    return { objectKey: args.objectKey, bucket: args.bucket };
  }

  async getObject(logicalBucket: string, objectKey: string): Promise<GetObjectResult> {
    const target = this.resolveBucket(logicalBucket);
    const key = this.resolveKey(logicalBucket, objectKey);
    const stat = await this.client.statObject(target, key);
    const stream = await this.client.getObject(target, key);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
          size: stat.size,
        });
      });
      stream.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });
  }

  // ------------------------------------------------------------------
  // Routing single-bucket (cloud) — privé
  // ------------------------------------------------------------------

  /**
   * En mode cloud, tous les buckets logiques sont mappés sur le bucket
   * physique unique. En mode dev, le bucket logique = bucket physique.
   */
  private resolveBucket(logicalBucket: string): string {
    return this.singleBucket ?? logicalBucket;
  }

  /**
   * En mode cloud, on préfixe la clé par le nom du bucket logique pour
   * conserver une séparation lisible des PDFs (BC / factures / rapports)
   * dans le seul bucket physique. En mode dev, la clé reste inchangée.
   *
   * Exemple cloud :
   *   logicalBucket="grantflow-invoices"
   *   objectKey="invoices/2026/05/abc.pdf"
   *   → "grantflow-invoices/invoices/2026/05/abc.pdf"
   */
  private resolveKey(logicalBucket: string, objectKey: string): string {
    if (!this.singleBucket) return objectKey;
    return `${logicalBucket}/${objectKey}`;
  }
}
