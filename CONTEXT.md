# CONTEXT.md — Velmap

## 1. Visão Geral do Projeto
O **Velmap** é um workspace visual em canvas infinito (inspirado em Milanote, Miro e Excalidraw), construído como aplicação **web estática pura** (`index.html` + `css/styles.css` + módulos em `js/`), sem necessidade de bundler para rodar ou fazer deploy (ex.: Netlify).

- **Persistência local:** IndexedDB (`VelmapDB`, stores `boards`, `cards`, `connections`, `assets`) + `localStorage` para preferências de UI, perfil e histórico/estado visual.
- **Arquitetura dos scripts:** todos os arquivos JS compartilham escopo global no navegador e devem manter a **ordem de carregamento** definida no `index.html`.
- **Tipos de cards:** `sticky` (Nota com Markdown ao vivo), `column` (Contêiner vertical recolhível estilo Milanote), `document` (Documento com modal e Markdown ao vivo), `task` (Checklist com drag-and-drop), `subboard` (Quadro aninhado), `link`, `embed`, `image`, `video`, `table`, `comment`.

---

## 2. Ordem de Carregamento dos Arquivos

No `index.html`, os scripts são carregados nesta ordem (funções base vêm antes dos consumidores):

1. `css/tailwind.css` — CSS utilitário compilado estaticamente (gerado a partir de `css/tailwind-input.css` sem CDN)
2. `js/i18n.js` — Dicionário PT-BR / EN e troca de idioma
3. `js/db-state.js` — IndexedDB, estado global em memória, modo de edição e parser/editor Markdown ao vivo
4. `js/ui-history.js` — Boot da UI, histórico de navegação (Voltar/Avançar), Undo/Redo, Clipboard, templates iniciais e fundo do board
5. `js/context-toolbar.js` — Menu de contexto (botão direito), seleção múltipla, z-index/camadas, download de imagens e toolbar contextual
6. `js/connections.js` — Desenho SVG das linhas, âncoras, bolinhas *drag-to-connect*, reconexão de pontas e pontos de curva
7. `js/board-render.js` — Carregamento de boards, breadcrumbs, Home View (Áreas), busca e renderização de todos os tipos de cards e colunas
8. `js/media-links.js` — Criação de cards, upload/resolução de mídia (imagem/vídeo/GIF), embeds e extração de metadados de links
9. `js/drag-drop.js` — Arrastar da barra lateral, *Unsorted*, lixeira, tarefas, soltar em *columns* / *subboards* / breadcrumbs e física do ghost flutuante
10. `js/canvas-interactions.js` — Pan, zoom, seleção em caixa (*marquee*), arraste de cards no canvas, saída de cards de *columns* e reconexão de pontas/curvas de linhas
11. `js/cards-actions.js` — Ações de cards, *Unsorted* drawer, lixeira, tabelas, tarefas, atalhos de teclado e modal de Documento
12. `js/export.js` — Popover de exportação estilo Milanote (PDF padrão/alta qualidade, PNG, Word `.doc`, Markdown, texto simples, ZIP)
13. `js/settings-profile.js` — Modal de configurações, perfil do usuário, recorte de avatar (PFP) e limpeza de armazenamento
14. `js/sync.js` — Sincronização entre dispositivos (WebRTC P2P + QR Code + arquivo local `.velmap`)
15. `js/pwa.js` — Botão de instalação PWA (`beforeinstallprompt` + guia iOS Safari) e indicador offline

---

## 3. Mapa Rápido: "O que você quer mudar?" → "Qual arquivo editar?"

| Funcionalidade / Área | Arquivo(s) principal(is) | O que controla |
|---|---|---|
| **Estrutura da página, modais, topbar e barra lateral** | `index.html` | HTML da barra superior (Voltar/Avançar, breadcrumbs, busca desktop/flutuante mobile), toolbar esquerda, drawer *Unsorted* (sidebar no desktop / card flutuante no mobile), bottom navbar mobile (`#mobile-bottom-nav`), sheets flutuantes (`#mobile-tools-sheet`, `#mobile-more-sheet`), modais e inclusão dos scripts |
| **Estilos visuais, cores, scrollbars e tipografia Markdown** | `css/styles.css`<br>`css/tailwind-input.css` | Bordas de seleção (`.selected-card`, `.multi-selection-active`), bolinhas de conexão, layout de `.column-card`, dock contextual mobile (`.mobile-context-dock`), altura automática das notas (`.note-card`), `#doc-editor`, `.md-rich-content`, padrões de fundo e tokens Tailwind v4 (`@theme`) |
| **Textos e traduções (EN / PT-BR)** | `js/i18n.js` | Objeto de traduções `I18N`, função `t(key)` e `applyTranslations()` |
| **Banco de dados, estado global e Markdown ao vivo** | `js/db-state.js` | `initDB`, `dbPut/Get/All/Delete`, variáveis globais (`cards`, `connections`, `selectedCardIds`, `currentBoardId`, `navHistory`), `enterCardEditMode`, `exitCardEditMode`, `markdownToRichHtml`, `attachLiveMarkdownEditor`, `stripHtmlToText` |
| **Renderização de cards, colunas e navegação Home/Board** | `js/board-render.js` | `loadBoard`, `openSubBoard`, `openHomeView`, `renderHomeView`, `renderBreadcrumbs`, `fetchAndRenderCards`, `toggleColumnCollapse`, `renderCanvasCards`, `buildCanvasCardElement` (inclui notas, colunas, contadores de subboards, tabelas, links, embeds) |
| **Conexões e linhas entre elementos** | `js/connections.js`<br>`js/canvas-interactions.js` | `drawConnections`, `attachConnectionDots`, `startConnectionDraw`, `resolveVisibleConnectionEl`, `getCanvasRelativeOffset`; arraste de pontas (`isReconnectingEndpoint`), ponto de curva (`isDraggingControl`) e `findReconnectTargetCard` |
| **Pan, zoom, arraste livre no canvas e marquee** | `js/canvas-interactions.js` | `setupCanvasInteractions`, `startCardDrag`, `startImageResize`, `promoteDraggedCardsToCanvasSpace` (tirar item de dentro de coluna ao arrastar), zoom por scroll/pinch, pan com Space/Hand |
| **Drag-and-drop entre painéis, colunas, tarefas e lixeira** | `js/drag-drop.js` | Soltar ferramentas da sidebar no canvas/colunas, *Unsorted* <-> Canvas/Colunas, arraste para lixeira/breadcrumbs/subboards, reordenar tarefas (`moveTaskToCard`), `getHoveredColumnInfo`, `moveCardsToColumn`, `createCardInColumn` |
| **Menu de contexto (botão direito) e Toolbar contextual** | `js/context-toolbar.js` | `openContextMenuAt` (inclui *Connect with lines* em multisseleção), `connectSelectedWithLines`, `syncSelectionVisuals` (alterna `.mobile-context-dock` no mobile), cor/ícone de board, z-index (`bringToFront`, `sendToBack`) |
| **Voltar/Avançar, Undo/Redo, Copy/Paste, Mobile Sheets e Fundo** | `js/ui-history.js` | `navigateHistoryBack`, `navigateHistoryForward`, `recordNavHistoryEntry`, `undoAction`, `redoAction`, `copy/cut/paste/duplicate`, `seedFirstRunExperience`, sons (*cozy sounds*), `setBoardBg*`, `toggleMobileToolsSheet`, `toggleMobileMoreSheet`, `toggleMobileSearchBar`, `closeMobileSheets` |
| **Ações de cards, Documento, Lixeira, Unsorted e Atalhos** | `js/cards-actions.js` | `deleteCard`, `deleteSelectedCards`, `restoreCard`, `moveUnsortedCardToCanvas`, `moveSelectedToUnsorted`, `openDocumentModal`, `saveDocument`, `updateDocWordCount`, `setupKeyboardShortcuts` (`Delete`, `Esc`, setas, `Alt+Seta`, `Ctrl+Z/C/X/D/A`) |
| **Links, Embeds, Vídeos, Imagens e Criação de Cards** | `js/media-links.js` | `createCardAt`, `updateLinkUrl`, `parseEmbedUrl`, `extractLinkMetadata`, `saveImageBlobToUnsorted`, `saveVideoBlobToUnsorted` |
| **Perfil, Avatar e Limpeza de Dados** | `js/settings-profile.js` | `openSettingsModal`, upload e crop de avatar (`openPfpCropModal`), exibição de uso de armazenamento e reset de dados |
| **Exportação (PDF / PNG / Word / MD / TXT / ZIP)** | `js/export.js` | `toggleExportPopover`, `exportCurrentBoardPdf`, `exportCurrentBoardPng`, `exportLinearWord`, `exportLinearMarkdown`, `exportLinearPlainText`, `exportBoardAssetsZip` |
| **Sincronização P2P / QR / Arquivo `.velmap`** | `js/sync.js` | WebRTC, pareamento por código/QR, `exportVelmapFile`, `importVelmapFile`, `mergeVelmapSnapshot`, `linkLocalSyncFile` |
| **PWA, instalação e deploy Netlify** | `js/pwa.js`<br>`netlify.toml`<br>`vite.config.ts` | Prompt de instalação (`beforeinstallprompt`), modal guia iOS Safari, indicador offline, manifesto Web App, Workbox Service Worker e regras de build/cache Netlify |

---

## 4. Regras Importantes Para Futuras Tarefas (IA e Dev)

1. **Dependência entre arquivos:**
   - Alterou o HTML de um card em `js/board-render.js`? Verifique se seletores CSS (`css/styles.css`) ou handlers de drag/conexão (`js/canvas-interactions.js`, `js/drag-drop.js`, `js/connections.js`) dependem daquelas classes ou `data-*`.
   - Adicionou novos dados no card (ex.: `columnId`, `columnOrder`, `isCollapsed`)? Confira clonagem/cópia (`js/ui-history.js`), deleção/restauração (`js/cards-actions.js`) e limpeza ao mover para outro board/unsorted (`js/drag-drop.js`).
   - Adicionou texto visível na UI? Registre a chave em EN e PT-BR em `js/i18n.js` e use `t('chave')`.
2. **Coordenadas em Canvas vs. Column:**
   - Cards soltos usam `style.left` / `style.top` no `#cards-layer`. Cards dentro de `.column-stack` ficam em fluxo vertical dentro da coluna; por isso cálculos de linhas (`js/connections.js`) e seleção marquee (`js/canvas-interactions.js`) usam `getCanvasRelativeOffset(el)`.
3. **Pastas legadas não usadas no deploy estático:**
   - Caso exista uma pasta `src/` no repositório de ambiente (template Vite), ela **não** é carregada pelo `index.html` nem faz parte da versão estática pura em `.html` / `.css` / `.js`.
