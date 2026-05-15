import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Clé de métadata lue par `JwtAuthGuard.canActivate` pour court-circuiter
 * la vérification du token.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque une route comme accessible sans authentification.
 * Réserver aux endpoints réellement publics (`/health`, éventuellement
 * `/auth/login` si un jour on en ajoute un). NE PAS utiliser pour des
 * routes "ouvertes en lecture mais loguées" — celles-là restent protégées.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
