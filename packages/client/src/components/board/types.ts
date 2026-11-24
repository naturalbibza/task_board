/** Контракт WS-мутаций для доски (используется компонентами доски). */
export interface WsApi {
  createColumn: (title: string) => void;
  createColumnFromTemplate: (templateId: string, title?: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteColumn: (columnId: string) => void;
  createCard: (columnId: string, title: string) => void;
  updateCard: (cardId: string, patch: { title?: string; description?: string | null }) => void;
  moveCardToEnd: (cardId: string, toColumnId: string) => void;
  deleteCard: (cardId: string) => void;
  editingStart: (cardId: string) => void;
  editingStop: (cardId: string) => void;
}
