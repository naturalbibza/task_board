// Шаблоны колонок (v2, FR-43): системные и пользовательские.
import type { BoardTemplateDto, ColumnTemplateDto } from '@task-board/shared';
import { api } from './http';

export function listTemplates(): Promise<{ templates: ColumnTemplateDto[] }> {
  return api<{ templates: ColumnTemplateDto[] }>('/column-templates');
}

/** «Сохранить колонку как шаблон»: карточки копирует сервер. */
export function saveColumnTemplate(columnId: string, title?: string): Promise<{ template: ColumnTemplateDto }> {
  return api<{ template: ColumnTemplateDto }>('/column-templates', {
    method: 'POST',
    body: JSON.stringify(title?.trim() ? { columnId, title: title.trim() } : { columnId }),
  });
}

export function deleteColumnTemplate(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/column-templates/${id}`, { method: 'DELETE' });
}

// --- Шаблоны досок (FR-51) ---

export function listBoardTemplates(): Promise<{ templates: BoardTemplateDto[] }> {
  return api<{ templates: BoardTemplateDto[] }>('/board-templates');
}

/** «Сохранить доску как шаблон»: колонки и карточки копирует сервер. */
export function saveBoardTemplate(boardId: string, title?: string): Promise<{ template: BoardTemplateDto }> {
  return api<{ template: BoardTemplateDto }>('/board-templates', {
    method: 'POST',
    body: JSON.stringify(title?.trim() ? { boardId, title: title.trim() } : { boardId }),
  });
}

export function deleteBoardTemplate(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/board-templates/${id}`, { method: 'DELETE' });
}
