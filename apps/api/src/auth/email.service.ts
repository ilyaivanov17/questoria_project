import { Injectable } from '@nestjs/common';
import { getWebOrigin } from '../config/web-origin.js';

type EmailKind = 'verification' | 'password-reset';

@Injectable()
export class EmailService {
  private readonly provider =
    process.env.EMAIL_PROVIDER?.trim().toLowerCase() ??
    (process.env.NODE_ENV === 'production' ? 'resend' : 'console');

  private readonly apiKey = process.env.RESEND_API_KEY?.trim();
  private readonly from = process.env.EMAIL_FROM?.trim();

  constructor() {
    if (this.provider !== 'console' && this.provider !== 'resend') {
      throw new Error('EMAIL_PROVIDER must be either "console" or "resend".');
    }

    if (this.provider === 'console' && process.env.NODE_ENV === 'production') {
      throw new Error('EMAIL_PROVIDER=console is only allowed outside production.');
    }

    if (this.provider === 'resend' && (!this.apiKey || !this.from)) {
      throw new Error('RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend.');
    }
  }

  async sendVerification(email: string, token: string): Promise<boolean> {
    const url = this.buildActionUrl('/verify-email', token);
    return this.deliver({
      email,
      kind: 'verification',
      url,
      subject: 'Подтверди электронную почту в Questoria',
      text: [
        'Привет!',
        'Подтверди адрес электронной почты, чтобы активировать аккаунт Questoria.',
        url,
        'Ссылка действует 24 часа и может быть использована один раз.',
      ].join('\n\n'),
      html: this.emailHtml(
        'Подтверди электронную почту',
        'Чтобы активировать аккаунт Questoria, перейди по ссылке.',
        url,
        'Ссылка действует 24 часа и может быть использована один раз.',
      ),
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<boolean> {
    const url = this.buildActionUrl('/reset-password', token);
    return this.deliver({
      email,
      kind: 'password-reset',
      url,
      subject: 'Сброс пароля Questoria',
      text: [
        'Мы получили запрос на смену пароля Questoria.',
        url,
        'Ссылка действует 30 минут и может быть использована один раз.',
        'Если ты не запрашивал сброс пароля, просто проигнорируй это письмо.',
      ].join('\n\n'),
      html: this.emailHtml(
        'Сброс пароля',
        'Чтобы задать новый пароль Questoria, перейди по ссылке.',
        url,
        'Ссылка действует 30 минут и может быть использована один раз. Если ты не запрашивал сброс, проигнорируй письмо.',
      ),
    });
  }

  private buildActionUrl(path: string, token: string): string {
    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const baseUrl = configuredSiteUrl || getWebOrigin();
    const url = new URL(path, baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private emailHtml(title: string, description: string, url: string, note: string): string {
    const escapedUrl = this.escapeHtml(url);
    const escapedTitle = this.escapeHtml(title);
    const escapedDescription = this.escapeHtml(description);
    const escapedNote = this.escapeHtml(note);

    return [
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#24243a;max-width:560px;margin:0 auto">',
      '<p style="font-size:12px;letter-spacing:2px;color:#7165cf;font-weight:700">QUESTORIA</p>',
      '<h1 style="font-size:24px">',
      escapedTitle,
      '</h1><p>',
      escapedDescription,
      '</p><p><a style="display:inline-block;padding:12px 18px;background:#6b5dd3;color:#fff;text-decoration:none;border-radius:10px" href="',
      escapedUrl,
      '">Продолжить</a></p><p style="font-size:12px;color:#686b7a">',
      escapedNote,
      '</p></div>',
    ].join('');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async deliver(message: {
    email: string;
    kind: EmailKind;
    url: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<boolean> {
    if (this.provider === 'console') {
      process.stdout.write(
        'QUESTORIA_EMAIL ' +
          JSON.stringify({
            email: message.email,
            kind: message.kind,
            url: message.url,
          }) +
          '\n',
      );
      return true;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.email],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error('Resend returned HTTP ' + response.status + '.');
      }

      return true;
    } catch (error) {
      console.error('Questoria email delivery failed:', {
        kind: message.kind,
        reason: error instanceof Error ? error.message : 'Unknown delivery error.',
      });
      return false;
    }
  }
}
