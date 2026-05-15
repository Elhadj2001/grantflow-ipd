/**
 * Charge le .env de la racine du monorepo AVANT que tout autre import
 * (typiquement `@prisma/client`) ne lise `process.env.DATABASE_URL`.
 *
 * Astuce : TypeScript hoiste tous les `import` en tête du JS compilé,
 * donc si on appelait `dotenv.config()` après l'import de @prisma/client
 * dans `seed.ts`, l'env serait chargé TROP TARD. En l'isolant ici et en
 * l'important en PREMIER dans `seed.ts` (import side-effect `import
 * './load-env'`), on garantit l'ordre d'exécution :
 *
 *   1. require('./load-env')    → dotenv.config()  (effet de bord)
 *   2. require('@prisma/client') → lit DATABASE_URL déjà présent
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });
