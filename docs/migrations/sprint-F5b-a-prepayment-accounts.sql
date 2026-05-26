-- =====================================================================
--  GRANTFLOW IPD — Sprint F5b-a Lot 3 (idempotent migration)
--  Ajout des comptes SYSCEBNL/SYSCOHADA de régularisation :
--    - 476 : Charges constatées d'avance (CCA)
--    - 477 : Produits constatés d'avance (PCA)
--
--  ⚠️  Nouveaux comptes au plan comptable — CONFORMÉMENT À CLAUDE.md §9,
--      cette modification doit être validée par le Contrôle de Gestion
--      (Mme KANE) avant déploiement en production. Les numéros 476/477
--      sont les références SYSCOHADA/SYSCEBNL standard pour les
--      régularisations de comptes de tiers.
--
--  Aucun trigger, CHECK ou GENERATED column n'est touché.
--  Script idempotent — peut être ré-exécuté sans erreur ni doublon.
-- =====================================================================

INSERT INTO ref.gl_account (code, label, class, is_movement, syscebnl_specific)
VALUES
    ('476', 'Charges constatées d''avance (CCA)', '4', true, false),
    ('477', 'Produits constatés d''avance (PCA)', '4', true, false)
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    class = EXCLUDED.class,
    is_movement = EXCLUDED.is_movement;
