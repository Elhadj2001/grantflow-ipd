import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentRunService } from './services/payment-run.service';
import {
  AddInvoicesToRunDto,
  ApprovePaymentRunDto,
  CancelPaymentRunDto,
  CreatePaymentRunDto,
  PaymentRunQueryDto,
  RejectPaymentRunDto,
  RemoveInvoicesFromRunDto,
} from './dto/payment-run.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller()
export class PaymentRunController {
  constructor(
    private readonly svc: PaymentRunService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------
  // Lecture
  // ------------------------------------------------------------------

  @Get('payment-runs')
  @ApiOperation({ summary: 'Liste paginée des payment runs' })
  list(@Query() query: PaymentRunQueryDto) {
    return this.svc.findMany(query);
  }

  @Get('payment-runs/:id')
  @ApiOperation({ summary: 'Détail payment run + paiements + facture courte' })
  @ApiNotFoundResponse({ description: 'BUSINESS.NOT_FOUND' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('payment-runs/:id/payments')
  @ApiOperation({ summary: 'Paiements rattachés au run' })
  payments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.listPayments(id);
  }

  @Get('payment-runs/:id/journal-entries')
  @ApiOperation({ summary: 'Écritures BQ associées (1 par paiement executed)' })
  journalEntries(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.listJournalEntries(id);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Détail d\'un paiement' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  async paymentDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          select: { id: true, invoiceNumber: true, totalTtc: true, currency: true, status: true },
        },
        paymentRun: { select: { id: true, runNumber: true, status: true } },
      },
    });
    if (!p) {
      // EntityNotFoundException-équivalent inline pour rester minimal
      return { statusCode: 404, code: 'BUSINESS.NOT_FOUND' };
    }
    return p;
  }

  @Get('invoices/:invoiceId/payments')
  @ApiOperation({ summary: 'Historique des paiements pour une facture' })
  historyForInvoice(@Param('invoiceId', new ParseUUIDPipe()) invoiceId: string) {
    return this.prisma.payment.findMany({
      where: { invoiceId },
      include: { paymentRun: { select: { runNumber: true, status: true, runDate: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------

  @Post('payment-runs')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Créer un PaymentRun (status=draft) avec une liste de factures',
    description:
      'Toutes les factures doivent être en posted/partially_paid, dans la même devise ' +
      "que le bankAccount, et ne pas déjà être dans un run actif (draft/prepared/executed).",
  })
  @ApiConflictResponse({
    description:
      'INVOICE_NOT_PAYABLE / PAYMENT_CURRENCY_MISMATCH / INVOICE_ALREADY_IN_RUN / BANK_ACCOUNT_INACTIVE',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.createRun(actor, dto);
  }

  @Post('payment-runs/:id/invoices')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Ajouter des factures à un run en draft' })
  @ApiConflictResponse({ description: 'PAYMENT_RUN_NOT_EDITABLE / INVOICE_NOT_PAYABLE / ...' })
  async addInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddInvoicesToRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.addInvoices(actor, id, dto);
  }

  @Delete('payment-runs/:id/invoices')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Retirer des paiements d\'un run en draft' })
  @ApiConflictResponse({ description: 'PAYMENT_RUN_NOT_EDITABLE' })
  async removeInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RemoveInvoicesFromRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.removeInvoices(actor, id, dto.paymentIds);
  }

  @Post('payment-runs/:id/prepare')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Passer le run en prepared (validation IBAN + payments → prepared)',
  })
  @ApiConflictResponse({
    description: 'PAYMENT_RUN_NOT_PREPARABLE / PAYMENT_RUN_EMPTY / MISSING_IBAN',
  })
  async prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.prepare(actor, id);
  }

  @Post('payment-runs/:id/approve')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Approuver et exécuter le run (DAF) — crée les écritures BQ',
  })
  @ApiOkResponse({ description: 'PaymentRun en executed' })
  @ApiConflictResponse({
    description:
      'PAYMENT_RUN_NOT_APPROVABLE / BANK_ACCOUNT_INACTIVE / BANK_ACCOUNT_WRONG_CLASS / PERIOD_CLOSED',
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApprovePaymentRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.approve(actor, id, dto.comment);
  }

  @Post('payment-runs/:id/reject')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Rejeter un run prepared (DAF)' })
  @ApiConflictResponse({ description: 'PAYMENT_RUN_NOT_REJECTABLE' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectPaymentRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.reject(actor, id, dto.reason);
  }

  @Post('payment-runs/:id/cancel')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Annuler un run en draft (avant prepare)' })
  @ApiConflictResponse({ description: 'PAYMENT_RUN_NOT_CANCELLABLE' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelPaymentRunDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.svc.cancel(actor, id, dto.reason);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async resolveActor(user: AuthenticatedUser) {
    const existing = await this.prisma.appUser.findUnique({
      where: { email: user.email },
      select: { id: true, fullName: true },
    });
    if (existing) {
      return { id: existing.id, email: user.email, fullName: existing.fullName ?? user.fullName };
    }
    // Auto-provision (même approche qu'InvoiceService.resolveAppUserId).
    const created = await this.prisma.appUser.create({
      data: { email: user.email, fullName: user.fullName || user.email },
      select: { id: true, fullName: true },
    });
    return { id: created.id, email: user.email, fullName: created.fullName ?? user.fullName };
  }
}
