// Контракты, общие для клиента и сервера: WS-протокол, DTO, схемы валидации.
// Всё, что импортируется из @task-board/shared, не должно дублироваться в других пакетах.

export * from './env';
export * from './api-types';
export * from './ws-events';
