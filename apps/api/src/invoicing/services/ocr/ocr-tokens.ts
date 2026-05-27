/**
 * Sprint F-OCR-VISION — Injection tokens Nest pour le multi-provider OCR.
 *
 * Le provider Vision est OPTIONNEL : on l'injecte via un token symbolique
 * pour pouvoir le câbler avec `useFactory` (qui retourne `null` si la
 * config ne le demande pas / si ANTHROPIC_API_KEY est absent).
 */
export const OCR_VISION_PROVIDER = Symbol('OCR_VISION_PROVIDER');
