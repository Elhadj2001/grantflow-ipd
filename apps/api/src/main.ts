import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

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
