-- =====================================================================
--  GRANTFLOW IPD — Sprint F-PO-EMAIL (idempotent migration)
--  Ajout de `ref.supplier.contact_email` pour l'envoi automatique du
--  Bon de Commande (PDF) au fournisseur par e-mail.
--
--  Sémantique :
--    - Champ optionnel (TEXT NULL). Pas de contrainte format au niveau
--      DB — la validation e-mail est faite côté DTO (Zod) à l'entrée.
--    - Si NULL, le BC est marqué `sent` sans notification (le service
--      logue un warning et continue ; l'engagement classe 8 n'est PAS
--      rollback).
--
--  Invariants à preserver (vérifiés en revue, cf. CLAUDE.md §9) :
--    - Aucun trigger / CHECK / GENERATED column sur ref.supplier — la
--      table n'en a pas, donc rien à invalider.
--    - L'index gin_trgm idx_supplier_name_trgm reste intact.
--
--  Script idempotent — peut être ré-exécuté sans erreur ni doublon.
-- =====================================================================

ALTER TABLE ref.supplier
    ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN ref.supplier.contact_email IS
    'E-mail de contact fournisseur (sprint F-PO-EMAIL). Destinataire des BC PDF. Best-effort : NULL toléré.';
