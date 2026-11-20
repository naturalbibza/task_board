import type { MailMessage } from './mailer';

type Body = Omit<MailMessage, 'to'>;

function layout(title: string, body: string, link: string, linkLabel: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5f7;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
    <div style="font-size:18px;font-weight:600;margin-bottom:12px">${title}</div>
    <div style="font-size:14px;line-height:1.55;color:#42526e">${body}</div>
    <p style="margin:22px 0"><a href="${link}" style="display:inline-block;background:#0c66e4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${linkLabel}</a></p>
    <p style="font-size:12px;color:#6b778c;word-break:break-all">Если кнопка не работает, откройте ссылку: ${link}</p>
    <p style="font-size:12px;color:#6b778c">Task Board</p>
  </div>
</body></html>`;
}

export function verifyEmailMessage(name: string, link: string): Body {
  return {
    subject: 'Подтвердите email — Task Board',
    text: `Здравствуйте, ${name}!

Подтвердите адрес электронной почты, чтобы создавать доски и приглашать участников:
${link}

Ссылка действует 24 часа. Если вы не регистрировались — просто проигнорируйте письмо.`,
    html: layout(
      'Подтвердите email',
      `Здравствуйте, ${name}!<br/><br/>Подтвердите адрес, чтобы создавать доски и приглашать участников. Ссылка действует 24 часа.`,
      link,
      'Подтвердить email',
    ),
  };
}

export function inviteMessage(options: {
  boardTitle: string;
  inviterName: string;
  roleLabel: string;
  link: string;
}): Body {
  return {
    subject: `Приглашение на доску «${options.boardTitle}» — Task Board`,
    text: `${options.inviterName} приглашает вас на доску «${options.boardTitle}» с ролью «${options.roleLabel}»:

${options.link}

Если вы не ожидали приглашение — проигнорируйте письмо.`,
    html: layout(
      'Приглашение на доску',
      `${options.inviterName} приглашает вас на доску «${options.boardTitle}» с ролью «${options.roleLabel}».`,
      options.link,
      'Присоединиться',
    ),
  };
}
