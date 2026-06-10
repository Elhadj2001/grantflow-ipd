import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

// ---------------------------------------------------------------------
// BigInt JSON serialization — patch global au boot.
//
// Prisma retourne les colonnes BIGINT (budget_line.budgeted_amount_xof,
// note_technique.own_funds_contribution_xof, etc.) comme JavaScript BigInt
// natif. `JSON.stringify` ne sait pas sérialiser un BigInt et lève
// `TypeError: Do not know how to serialize a BigInt`.
//
// Ce patch installe une méthode `toJSON` sur BigInt.prototype qui
// convertit en Number quand la valeur est dans la plage safe
// (≤ Number.MAX_SAFE_INTEGER = 9 007 199 254 740 991, soit 9 quadrillions —
// largement suffisant pour des montants XOF). Au-delà, on sérialise en
// string pour préserver la précision (cas théorique, jamais atteint en
// pratique IPD).
//
// Référence : ce comportement est documenté comme TODO dans US-024 et
// US-033 (sérialisation locale au service). Patch global = plus
// d'oubli par service.
// ---------------------------------------------------------------------
(BigInt.prototype as unknown as { toJSON: () => unknown }).toJSON = function () {
  const asNumber = Number(this);
  return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);

  // Sécurité
  app.use(helmet());
  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  // Préfixe API + version
  app.setGlobalPrefix('api/v1');

  // Validation globale — Zod via nestjs-zod.
  //
  // Tous les DTO du projet sont déclarés via `createZodDto(zodSchema)` (cf.
  // create-pr.dto.ts). `ZodValidationPipe` global :
  //  - valide le body / query / params contre le schéma Zod du DTO,
  //  - renvoie 400 avec un body normalisé `{ statusCode, message, errors }`
  //    si la validation échoue (au lieu de laisser passer un payload
  //    invalide qui ferait planter le service en 500).
  app.useGlobalPipes(new ZodValidationPipe());

  // Swagger OpenAPI
  const swagger = new DocumentBuilder()
    .setTitle('GRANTFLOW IPD API')
    .setDescription('API REST de la plateforme GRANTFLOW IPD')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);

  Logger.log(`🚀 GRANTFLOW API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`📚 Swagger UI on http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
