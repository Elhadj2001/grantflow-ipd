import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PurchaseRequestService } from './purchase-request.service';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';

@ApiBearerAuth()
@ApiTags('procurement')
@Controller('purchase-requests')
export class PurchaseRequestController {
  constructor(private readonly svc: PurchaseRequestService) {}

  @Post()
  @ApiOperation({ summary: 'Créer une demande d\'achat (statut DRAFT)' })
  async create(@Body() dto: CreatePurchaseRequestDto) {
    // TODO: récupérer userId depuis @CurrentUser() une fois AuthGuard implémenté
    const userId = 'placeholder-user-id';
    return this.svc.create(userId, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Soumettre la DA à validation' })
  async submit(@Param('id') id: string) {
    const userId = 'placeholder-user-id';
    return this.svc.submit(id, userId);
  }

  // TODO Sprint 2 :
  // - GET / : liste paginée filtrable
  // - GET /:id : détail
  // - POST /:id/approve
  // - POST /:id/reject
  // - DELETE /:id : annulation (statuts autorisés uniquement)
}
