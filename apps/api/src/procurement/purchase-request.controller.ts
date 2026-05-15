import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PurchaseRequestService } from './purchase-request.service';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

@ApiBearerAuth()
@ApiTags('procurement')
@Controller('purchase-requests')
export class PurchaseRequestController {
  constructor(private readonly svc: PurchaseRequestService) {}

  @Post()
  @Roles('DEMANDEUR', 'PI', 'SUPER_ADMIN')
  @ApiOperation({ summary: "Créer une demande d'achat (statut DRAFT)" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePurchaseRequestDto,
  ): Promise<unknown> {
    return this.svc.create(user, dto);
  }

  @Post(':id/submit')
  @Roles('PI', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Soumettre la DA à validation' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.svc.submit(id, user);
  }

  // TODO Sprint 2 :
  // - GET / : liste paginée filtrable
  // - GET /:id : détail
  // - POST /:id/approve
  // - POST /:id/reject
  // - DELETE /:id : annulation (statuts autorisés uniquement)
}
