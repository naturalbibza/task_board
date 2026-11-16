import type { MessengerType } from './api-types';

/** Подписи контактов — общие для профиля и карточки участника. */
export const MESSENGER_LABELS: Record<MessengerType, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  other: 'Другое',
};
