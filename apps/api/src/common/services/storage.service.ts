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
 * Service de stockage objet — MinIO en dev, S3 compatible en prod.
 *
 * Buckets utilisés :
 *   grantflow-pos       PDFs des bons de commande (sprint 3)
 *   grantflow-invoices  PDFs des factures (sprint 4+)
 *   grantflow-reports   livrables bailleurs (sprint 5+)
 *
 * On crée le bucket à la demande (idempotent). Pas de retry policy
 * sophistiquée ici — en cas d'échec, on remonte l'exception et c'est au
 * caller de décider (typique : marquer le PO en `draft` plutôt que `sent`).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Minio.Client;
  private readonly endPoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;

  constructor(private readonly config: ConfigService) {
    this.endPoint = this.config.get<string>('MINIO_HOST') ?? 'localhost';
    this.port = parseInt(this.config.get<string>('MINIO_PORT') ?? '9000', 10);
    this.useSSL = this.config.get<string>('MINIO_USE_SSL') === 'true';
    this.client = new Minio.Client({
      endPoint: this.endPoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
      secretKey: this.config.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin',
    });
    this.logger.log({ endPoint: this.endPoint, port: this.port, useSSL: this.useSSL }, 'minio client init');
  }

  async onModuleInit(): Promise<void> {
    // Pas de bootstrap des buckets ici : on les crée à la demande dans
    // putObject (lazy). Cela évite de bloquer le démarrage de l'API si
    // MinIO est indisponible.
  }

  async ensureBucket(name: string): Promise<void> {
    const exists = await this.client.bucketExists(name);
    if (!exists) {
      await this.client.makeBucket(name);
      this.logger.log({ bucket: name }, 'bucket created');
    }
  }

  async putObject(args: PutObjectArgs): Promise<{ objectKey: string; bucket: string }> {
    await this.ensureBucket(args.bucket);
    const metaData = {
      'Content-Type': args.contentType ?? 'application/octet-stream',
      ...(args.metadata ?? {}),
    };
    await this.client.putObject(
      args.bucket,
      args.objectKey,
      args.buffer,
      args.buffer.length,
      metaData,
    );
    this.logger.log(
      { bucket: args.bucket, key: args.objectKey, size: args.buffer.length },
      'object uploaded',
    );
    return { objectKey: args.objectKey, bucket: args.bucket };
  }

  async getObject(bucket: string, objectKey: string): Promise<GetObjectResult> {
    const stat = await this.client.statObject(bucket, objectKey);
    const stream = await this.client.getObject(bucket, objectKey);
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
}
