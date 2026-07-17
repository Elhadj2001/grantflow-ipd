import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { InvoiceService } from './services/invoice.service';
import {
  CancelPostingDto,
  CreateInvoiceManualDto,
  ForceMatchDto,
  InvoiceQueryDto,
  RejectInvoiceDto,
  UpdateInvoiceDto,
  UploadHintDto,
} from './dto/invoice.dto';

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiBearerAuth()
@ApiTags('invoicing')
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller()
export class InvoiceController {
  constructor(private readonly svc: InvoiceService) {}

  // ------------------------------------------------------------------
  // Upload PDF + OCR (multipart/form-data)
  // ------------------------------------------------------------------

  @Post('invoices/upload')
  @Roles('COMPTABLE', 'SUPER_ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload PDF facture + OCR (capture)',
    description:
      "Le PDF est stocké dans MinIO (bucket grantflow-invoices). Le texte est extrait via " +
      "pdf-parse, puis des heuristiques extraient n° facture, dates, totaux, devise, BC. " +
      "Si le supplier n'est pas reconnu, passer supplierId en form-data (UploadHintDto).",
  })
  @ApiConflictResponse({ description: 'INVOICE_DUPLICATE_NUMBER si la facture existe déjà' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MulterFile,
    @Body() hint: UploadHintDto,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data field "file")');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException(`Expected application/pdf, received ${file.mimetype}`);
    }
    const res = await this.svc.uploadAndCapture(user, file.buffer, file.originalname, hint);
    return {
      invoiceId: res.invoice.id,
      invoiceNumber: res.invoice.invoiceNumber,
      status: res.invoice.status,
      pdfObjectKey: res.pdfObjectKey,
      ocr: {
        confidence: res.ocr.confidence,
        isImageScan: res.ocr.isImageScan,
        fields: res.ocr.fields,
        fieldConfidence: res.ocr.fieldConfidence,
      },
      invoice: res.invoice,
    };
  }

  // ------------------------------------------------------------------
  // Manual create
  // ------------------------------------------------------------------

  @Post('invoices')
  @Roles('COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer une facture manuellement (saisie comptable)' })
  @ApiConflictResponse({ description: 'INVOICE_DUPLICATE_NUMBER' })
  createManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceManualDto,
  ) {
    return this.svc.createManual(user, dto);
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get('invoices')
  // Sprint F-RBAC-LISTES : on gate l'endpoint pour exclure BAILLEUR
  // (aucun usage métier d'une liste globale de factures fournisseurs)
  // et MAGASINIER / CAISSIER (hors workflow). ACHETEUR / DEMANDEUR / PI
  // restent inclus — le service applique ensuite un filtre par rôle
  // (ACHETEUR voit les factures de SES BC ; DEMANDEUR/PI celles de
  // LEURS DAs). Le service expose donc une vue restreinte à leurs
  // données — pas un leak global. C'est plus large que la
  // recommandation initiale du brief pour préserver l'UX existante
  // (/accounting/invoices déjà accessible à ces rôles via la sidebar
  // "Comptabilité"). BAILLEUR retiré côté FULL_VIEW_ROLES en parallèle.
  @Roles(
    'ACHETEUR',
    'COMPTABLE',
    'CONTROLEUR',
    'DAF',
    'TRESORIER',
    'DEMANDEUR',
    'PI',
    'SUPER_ADMIN',
  )
  @ApiOperation({
    summary: 'Liste paginée des factures',
    description:
      'COMPTABLE / TRESORIER / CONTROLEUR / DAF / SUPER_ADMIN voient tout. ' +
      "ACHETEUR voit les factures de ses BC. DEMANDEUR/PI voient celles liées à leurs DAs. " +
      'BAILLEUR / MAGASINIER / CAISSIER : 403 (aucun usage métier).',
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: InvoiceQueryDto) {
    return this.svc.findMany(user, query);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Détail facture + lignes' })
  @ApiNotFoundResponse({ description: '404 (obscurité OWASP si non accessible)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(user, id);
  }

  @Get('invoices/:id/match-details')
  @ApiOperation({ summary: 'Détails du rapprochement 3-way (lignes invoice_match + summary)' })
  matchDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.findMatchDetails(user, id);
  }

  @Get('invoices/:id/documents')
  @ApiOperation({
    summary: 'US-069 — documents archivés de la facture (panneau Documents)',
    description:
      'Liste dérivée des métadonnées existantes (pdfObjectKey). Taille best-effort ' +
      '(null si stockage indisponible). Même RBAC que le détail facture.',
  })
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.listDocuments(user, id);
  }

  @Get('invoices/:id/pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF de la facture (stream depuis MinIO)' })
  @ApiNotFoundResponse({
    description: 'BUSINESS.DOCUMENT_NOT_FOUND — PDF jamais archivé ou objet absent (US-069)',
  })
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType, filename } = await this.svc.downloadPdf(user, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get('purchase-orders/:poId/invoices')
  @ApiOperation({ summary: 'Liste des factures liées à un BC' })
  forPo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poId', new ParseUUIDPipe()) poId: string,
  ) {
    return this.svc.findForPo(user, poId);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Patch('invoices/:id')
  @Roles('COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Corriger une facture capturée (en avant matching ou en exception)',
    description: 'Statuts éditables : captured / exception_price / exception_qty.',
  })
  @ApiConflictResponse({ description: 'INVOICE_NOT_EDITABLE / INVOICE_DUPLICATE_NUMBER' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Post('invoices/:id/submit')
  @Roles('COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Soumettre au matching 3-way',
    description:
      'Préconditions : status=captured, po_id renseigné, totaux > 0. ' +
      'Résultat : status devient matched / exception_price / exception_qty.',
  })
  @ApiOkResponse({ description: 'invoice + outcome (newStatus + summary)' })
  @ApiConflictResponse({
    description: 'INVOICE_NOT_CAPTURABLE / INVOICE_NO_PO_LINKED / MATCHING_NO_RECEIPT',
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.submitForMatching(user, id);
  }

  @Post('invoices/:id/force-match')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Forcer le statut matched malgré une exception (DAF/SUPER_ADMIN)',
    description:
      'Réservé aux cas exceptionnels. Le motif est obligatoire et tracé dans ' +
      "match_summary.forcedMatch — audit log marque l'événement FORCED_MATCH.",
  })
  @ApiConflictResponse({ description: 'INVOICE_NOT_CAPTURABLE si pas en exception_*' })
  forceMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ForceMatchDto,
  ) {
    return this.svc.forceMatch(user, id, dto);
  }

  @Post('invoices/:id/reject')
  @Roles('COMPTABLE', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Rejeter une facture (avant paiement)' })
  @ApiConflictResponse({ description: 'INVOICE_NOT_REJECTABLE si déjà payée/archivée' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectInvoiceDto,
  ) {
    return this.svc.reject(user, id, dto);
  }

  // ------------------------------------------------------------------
  // Posting (sprint 4.2b)
  // ------------------------------------------------------------------

  @Post('invoices/:id/post')
  @Roles('COMPTABLE', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Comptabiliser la facture (matched → posted)',
    description:
      'Crée une écriture AC (Achats) avec débit 6xx (charge) + débit 445 (TVA déductible) + ' +
      'crédit 401 (Fournisseurs au TTC, auxiliary_code=supplier.code) + imputation analytique ' +
      'héritée de la PR. Extourne en parallèle l\'engagement classe 8 du BC (801/802) ' +
      'pour la fraction facturée. Multidevises : lookup de exchange_rate à invoice_date ' +
      'et stockage des montants XOF + valeurs originales.',
  })
  @ApiOkResponse({ description: 'AC entry + reversal + exchangeRate + totalTtcXof' })
  @ApiConflictResponse({
    description:
      'INVOICE_NOT_POSTABLE / INVOICE_ALREADY_POSTED / PERIOD_CLOSED / ' +
      'EXCHANGE_RATE_MISSING / GL_ACCOUNT_NOT_FOUND',
  })
  post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.post(user, id);
  }

  @Post('invoices/:id/cancel-posting')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Annuler la comptabilisation (posted → matched)',
    description:
      'Réservé DAF / SUPER_ADMIN. Crée une AC inverse qui solde l\'écriture d\'origine, ' +
      're-crée l\'engagement classe 8 extourné lors du post. Refusé si paiement déjà émis. ' +
      'Motif obligatoire (audit trail).',
  })
  @ApiConflictResponse({
    description: 'INVOICE_NOT_POSTABLE (si pas posted) / POSTING_HAS_PAYMENT',
  })
  cancelPosting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelPostingDto,
  ) {
    return this.svc.cancelPosting(user, id, dto.reason);
  }

  @Get('invoices/:id/journal-entries')
  @ApiOperation({
    summary: 'Écritures comptables liées à la facture (AC + extournes classe 8)',
    description:
      'Retourne { acEntries: [AC + ses lignes], class8Reversals: [OD + ses lignes] }.',
  })
  journalEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.listJournalEntries(user, id);
  }
}
