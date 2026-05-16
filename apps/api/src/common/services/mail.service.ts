import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  /** true si SMTP a accepté l'envoi (peut être faux sans throw — dev mode). */
  delivered: boolean;
  /** Adresse envoyée (utile pour audit / logs). */
  to: string;
  /** Identifiant MessageId du transporteur SMTP, si dispo. */
  messageId: string | null;
  /** Erreur capturée si delivered=false. */
  error: string | null;
}

/**
 * Service email centralisé.
 *
 * En dev : pointe sur MailHog (SMTP localhost:1025, UI http://localhost:8025).
 * En prod : configurer SMTP_HOST/PORT/USER/PASS via .env.
 *
 * Principe : le service NE FAIT PAS échouer le flux métier si SMTP est
 * down. On log l'erreur, on retourne `delivered: false`, et c'est au
 * caller de décider (typique : marquer le PO comme `sent` quand même
 * parce que l'écriture comptable et le PDF sont OK, juste l'email a
 * raté → endpoint /resend disponible).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST') ?? 'localhost';
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '1025', 10);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('MAIL_FROM') ?? 'GRANTFLOW IPD <no-reply@pasteur.sn>';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // MailHog accepte sans TLS — on garde la flexibilité prod via env.
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });
    this.logger.log({ host, port, from: this.from }, 'mail transporter initialised');
  }

  async send(args: SendMailArgs): Promise<SendMailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        attachments: args.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType ?? 'application/octet-stream',
        })),
      });
      this.logger.log(
        { to: args.to, subject: args.subject, messageId: info.messageId },
        'mail sent',
      );
      return {
        delivered: true,
        to: args.to,
        messageId: (info.messageId as string | undefined) ?? null,
        error: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn({ to: args.to, subject: args.subject, err: msg }, 'mail send failed');
      return { delivered: false, to: args.to, messageId: null, error: msg };
    }
  }
}
