-- Бэкфилл ролей v2 (FR-23): было две роли (OWNER/MEMBER), стало четыре.
-- Все существующие участники становятся редакторами; владельцы не меняются.
UPDATE "board_members" SET "role" = 'EDITOR' WHERE "role" = 'MEMBER';
