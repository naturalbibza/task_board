import type { BoardTemplateDto, ColumnTemplateDto } from './api-types';

/**
 * Системные шаблоны колонок (v2, фаза 15): общие для всех, в БД не хранятся.
 * Пользовательские шаблоны — в column_templates (видны только автору).
 */
export const SYSTEM_COLUMN_TEMPLATES: ColumnTemplateDto[] = [
  {
    id: 'system-bugs',
    title: 'Баги',
    system: true,
    cards: [
      { title: 'Воспроизвести проблему', description: null },
      { title: 'Исправить', description: null },
      { title: 'Проверить на проде', description: null },
    ],
  },
  {
    id: 'system-study',
    title: 'Учёба',
    system: true,
    cards: [
      { title: 'Лекция', description: null },
      { title: 'Практика', description: null },
      { title: 'Домашнее задание', description: null },
    ],
  },
];

/**
 * Системные шаблоны досок (FR-51): готовые колонки и карточки.
 * Пользовательские шаблоны — в board_templates (видны только автору).
 */
export const SYSTEM_BOARD_TEMPLATES: BoardTemplateDto[] = [
  {
    id: 'system-board-project',
    title: 'Проект',
    system: true,
    columns: [
      {
        title: 'Бэклог',
        cards: [
          { title: 'Собрать требования', description: null },
          { title: 'Оценить сроки', description: null },
        ],
      },
      { title: 'В работе', cards: [{ title: 'Первая задача', description: null }] },
      { title: 'Проверка', cards: [] },
      { title: 'Готово', cards: [] },
    ],
  },
  {
    id: 'system-board-study',
    title: 'Учёба',
    system: true,
    columns: [
      {
        title: 'Лекции',
        cards: [
          { title: 'Записаться на курс', description: null },
          { title: 'Составить конспект', description: null },
        ],
      },
      {
        title: 'Практика',
        cards: [{ title: 'Решить задачи', description: null }],
      },
      {
        title: 'Домашнее задание',
        cards: [{ title: 'Сдать работу', description: null }],
      },
    ],
  },
];
