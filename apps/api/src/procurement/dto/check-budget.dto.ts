import { ApiProperty } from '@nestjs/swagger';

/** Détail par ligne budgétaire impactée par la DA. */
export class CheckBudgetLineDto {
  @ApiProperty({ format: 'uuid' })
  budgetLineId!: string;

  @ApiProperty({ example: 'L01' })
  code!: string;

  @ApiProperty({ example: 'Consommables labo' })
  label!: string;

  @ApiProperty({ example: 38000, description: 'budgetedAmount défini sur la ligne' })
  budgeted!: number;

  @ApiProperty({
    example: 12000,
    description: 'Somme déjà engagée (BC envoyés/reçus + DA pending hors celle-ci)',
  })
  alreadyConsumed!: number;

  @ApiProperty({
    example: 8000,
    description: 'Montant que CETTE DA consommerait sur la ligne',
  })
  willConsume!: number;

  @ApiProperty({ example: 18000, description: 'Reste après imputation = budgeted - alreadyConsumed - willConsume' })
  available!: number;

  @ApiProperty({ example: false })
  wouldExceed!: boolean;
}

/**
 * Réponse de l'endpoint `GET /:id/check-budget`. Permet au front d'afficher
 * un voyant rouge AVANT submit (UX > erreur HTTP 409 au submit).
 */
export class CheckBudgetResponseDto {
  @ApiProperty({ format: 'uuid' })
  prId!: string;

  @ApiProperty({ description: 'Total demandé par la DA (somme des lignes).' })
  currentTotal!: number;

  @ApiProperty({ description: 'Total restant globalement utilisable.' })
  available!: number;

  @ApiProperty({
    description: 'Total que la DA consommerait si soumise (= currentTotal).',
  })
  willConsume!: number;

  @ApiProperty({ description: 'true si au moins une ligne dépasse.' })
  wouldExceed!: boolean;

  @ApiProperty({ type: [CheckBudgetLineDto] })
  byLine!: CheckBudgetLineDto[];
}
