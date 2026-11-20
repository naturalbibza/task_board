-- Бэкфилл подтверждения email (v2, фаза 14): у существующих аккаунтов адрес
-- считаем подтверждённым, иначе после выката их бы ограничили (FR-32).
-- Новые регистрации после этой миграции получают emailVerifiedAt = null.
UPDATE "users" SET "emailVerifiedAt" = now() WHERE "emailVerifiedAt" IS NULL;
