import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { GrantOfficeModule } from './grant-office.module';
import { createPrismaMock } from '../test-utils/prisma-mock';

/**
 * Smoke DI : le graphe GrantOfficeModule (4 sous-modules) se résout sans
 * erreur. PrismaModule (@Global) fournit PrismaService, ici remplacé par un
 * mock (compile() n'appelle pas onModuleInit → pas de $connect réel).
 */
describe('GrantOfficeModule', () => {
  it('should compile (DI graph resolves)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, GrantOfficeModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
