// Отправка писем (v2, фаза 14): консоль (dev/офлайн) или SMTP (прод).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../db';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localMailDir = path.join(serverRoot, '.localmail');

/** Dev/офлайн: письмо пишется в .localmail/*.eml и печатается в лог (ссылка видна сразу). */
class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    mkdirSync(localMailDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(localMailDir, `${stamp}-${message.to.replace(/[^\w.@-]/g, '_')}.eml`);
    const eml = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
    ].join('\n');
    writeFileSync(file, eml, 'utf8');
    console.log(`[mail] ${message.to}: ${message.subject}\n${message.text}\n[mail] файл: ${file}`);
  }
}

class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }

  async send(message: MailMessage): Promise<void> {
    const info = await this.transporter.sendMail({
      from: env.MAIL_FROM_NAME ? `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM}>` : env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    console.log(`[mail] отправлено: ${message.to} (${info.messageId})`);
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (!mailer) {
    mailer = env.MAIL_MODE === 'smtp' ? new SmtpMailer() : new ConsoleMailer();
  }
  return mailer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Отправка «в фоне»: ошибка письма не должна ломать регистрацию/приглашение.
 * 3 попытки, ошибки — в лог.
 */
export async function sendMailSafely(message: MailMessage): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await getMailer().send(message);
      return;
    } catch (err) {
      if (attempt === 3) {
        console.error(`[mail] не удалось отправить письмо на ${message.to}:`, err);
        return;
      }
      await sleep(attempt * 1000);
    }
  }
}

/** Базовый адрес приложения для ссылок в письмах (прод — за Caddy, dev — Vite-прокси). */
export function baseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('host') ?? 'localhost:5173';
  return `${proto}://${host}`;
}
