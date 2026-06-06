# Collections Modal Redesign — Spec

**Date:** 2026-06-06  
**Status:** Approved for implementation

---

## Overview

Reemplazar el panel lateral de 400px de Colecciones por un modal a pantalla casi completa con:

1. **Layout de dos paneles** — árbol de colecciones a la izquierda, grid de items a la derecha.
2. **Subcarpetas** — colecciones anidadas con profundidad ilimitada (como las carpetas del Inventario).
3. **Drag & drop** — colecciones reordenables y anidables por drag; items reordenables dentro de una colección y movibles (no copiados) a otra.

El `CollectionPickerModal` (el mini popup para guardar un item desde la tienda) **no cambia** — sigue siendo un picker plano.

---

## Diseño visual

- Modal: `fixed inset-0 z-50` backdrop semitransparente + shell central `w-[92vw] h-[88vh]`, `border-radius 14px`.
- Barra superior: título "Colecciones" + botón "Nueva colección" + botón cerrar.
- Panel izquierdo: `220px` fijo, árbol de colecciones expandible/colapsable.
- Panel derecho: `flex-1`, grid de thumbnails auto-fill `minmax(130px, 1fr)`.
- Cards de item: thumbnail cuadrado + nombre, precio y autor. Hover muestra "abrir en Booth" y "quitar de colección".
- Drop target en árbol: highlight rojo `rgba(220,38,38,.12)` + borde `rgba(220,38,38,.35)`.

---

## DB — Migración `020_collections_folders.sql`

```sql
ALTER TABLE shop_collections ADD COLUMN parent_id   TEXT REFERENCES shop_collections(id) ON DELETE SET NULL;
ALTER TABLE shop_collections ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_collection_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
```

> SQLite no soporta `ADD COLUMN ... REFERENCES` con comprobación estricta de FK, pero la columna se añade sin error; la integridad se gestiona desde Rust.

---

## Backend Rust — `src-tauri/src/commands/collections.rs`

### Tipos actualizados

```rust
pub struct Collection {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub description: String,
    pub parent_id: Option<String>,   // NEW
    pub sort_order: i64,             // NEW
    pub created_at: String,
    pub updated_at: String,
    pub item_count: i64,
}

pub struct CollectionItem {
    // existing fields…
    pub sort_order: i64,             // NEW
}
```

### Query `collections_list` actualizada

Añadir `c.parent_id, c.sort_order` al SELECT y cambiar `ORDER BY c.sort_order ASC, c.updated_at DESC`.

### Nuevos comandos

| Comando Tauri | Firma Rust | Descripción |
|---|---|---|
| `collection_move_to_parent` | `(collection_id: String, parent_id: Option<String>)` | Cambia `parent_id` de una colección |
| `collections_reorder` | `(ids: Vec<String>)` | Actualiza `sort_order` de colecciones en bloque |
| `collection_items_reorder` | `(collection_id: String, ids: Vec<String>)` | Actualiza `sort_order` de items en bloque |
| `collection_item_move` | `(item_id: String, from_collection_id: String, to_collection_id: String)` | Mueve item: si no existe en destino, actualiza `collection_id`; si ya existe en destino, borra la fila origen (el item ya está donde queremos). |

Todos son async + `spawn_blocking`. Se registran en `lib.rs` en el invoke handler.

---

## Frontend — `src/lib/tauri.ts`

### Tipos actualizados

```ts
export interface Collection {
  // existing…
  parent_id: string | null;   // NEW
  sort_order: number;         // NEW
}

export interface CollectionItem {
  // existing…
  sort_order: number;         // NEW
}
```

### Nuevos bindings

```ts
export const tauriCollectionMoveToParent = (collectionId: string, parentId: string | null) =>
  invoke<void>("collection_move_to_parent", { collectionId, parentId });

export const tauriCollectionsReorder = (ids: string[]) =>
  invoke<void>("collections_reorder", { ids });

export const tauriCollectionItemsReorder = (collectionId: string, ids: string[]) =>
  invoke<void>("collection_items_reorder", { collectionId, ids });

export const tauriCollectionItemMove = (itemId: string, fromCollectionId: string, toCollectionId: string) =>
  invoke<void>("collection_item_move", { itemId, fromCollectionId, toCollectionId });
```

---

## Frontend — `src/store/collectionsStore.ts`

Nuevas acciones:

```ts
moveCollectionToParent: (id: string, parentId: string | null) => Promise<void>;
reorderCollections: (ids: string[]) => Promise<void>;
reorderItems: (collectionId: string, ids: string[]) => Promise<void>;
moveItem: (itemId: string, fromCollectionId: string, toCollectionId: string) => Promise<void>;
```

Implementaciones:
- `moveCollectionToParent` llama `tauriCollectionMoveToParent` y actualiza `parent_id` localmente.
- `reorderCollections` llama `tauriCollectionsReorder` y actualiza `sort_order` en store.
- `reorderItems` solo persiste (los items viven en estado local del componente).
- `moveItem` llama `tauriCollectionItemMove`, decrementa `item_count` de la colección origen e incrementa la destino.

---

## Frontend — Nuevos componentes

### `src/components/shop/CollectionsModal.tsx`

Punto de entrada. Responsabilidades:
- Shell del modal (`fixed inset-0` backdrop + panel centrado).
- `DndContext` único que envuelve ambos paneles.
- Estado: `selectedCollectionId`, `items` del panel derecho, `localOrder` para reorden optimista.
- Cierre con `Escape` o clic en backdrop.
- `onDragEnd` con lógica de despacho:
  - `item:<id>` soltado sobre `col:<id>` → `moveItem`
  - `item:<id>` soltado sobre `item:<id>` → `reorderItems`
  - `col:<id>` soltado sobre `col:<id>` → `moveCollectionToParent` (si parent distinto) o `reorderCollections`
  - `col:<id>` soltado sobre `root` → `moveCollectionToParent(id, null)`

Detección de colisiones: `folderFirstCollision` (prioriza targets `col:` sobre `item:`), mismo patrón que `InventoryGrid`.

### `src/components/shop/CollectionTree.tsx`

Panel izquierdo. Responsabilidades:
- Renderiza árbol recursivo de colecciones filtradas por `parent_id`.
- Cada fila: `useSortable` + chevron expand/collapse + cover 22px + nombre + count.
- Indentación proporcional al nivel (`paddingLeft = depth * 14px`).
- Highlight de drop target cuando un drag pasa por encima.
- Input "Nueva colección" en el footer con `onKeyDown Enter`.
- No abre colecciones al hacer click si hay un drag activo.

### `src/components/shop/CollectionItemsGrid.tsx`

Panel derecho. Responsabilidades:
- `SortableContext` con `rectSortingStrategy`.
- `DragOverlay` con ghost card rotado 2deg + scale 1.05.
- Cada card: thumbnail, nombre, precio, autor. Hover: botón "abrir Booth" (abre URL) + botón "quitar" (remove from collection).
- Estado vacío si colección seleccionada no tiene items.
- Skeleton loader mientras `loadingItems`.

---

## Modificaciones en archivos existentes

| Archivo | Cambio |
|---|---|
| `src/pages/Shop.tsx` | Importar `CollectionsModal` en lugar de `CollectionsView`; cambiar JSX en línea 246 |
| `src/components/shop/CollectionsView.tsx` | Mantener temporalmente (puede borrarse al final) |
| `src-tauri/src/lib.rs` | Añadir los 4 nuevos comandos al invoke handler |
| `src-tauri/src/db/migrations/` | Añadir `020_collections_folders.sql` |

---

## Drag & Drop — Modelo de IDs

```
Drags de colección:  "col:<uuid>"
Drags de item:       "item:<uuid>"
Drop target árbol:   "col:<uuid>"   (mismo prefijo — las tree-rows son drop targets)
Drop target root:    "root"
Drop target grid:    "item:<uuid>"  (para reordenar)
```

La función `folderFirstCollision` ordena los hits para que un drop sobre una tree-row siempre se resuelva como mover-a-colección, no como reordenar entre items.

---

## Interacciones excluidas del scope

- Búsqueda de items dentro de una colección — fuera del scope.
- Multi-selección de items para mover varios a la vez — fuera del scope.
- El `CollectionPickerModal` (picker rápido al guardar un producto) — sin cambios.
- Cover de colección desde URL — se mantiene el comportamiento actual (botón en menú contextual de la tree-row, no en el diseño inicial).

---

## Orden de implementación

1. Migración SQL + tipos Rust + comandos Rust + `cargo check`
2. `tauri.ts` — tipos e IDs nuevos
3. `collectionsStore.ts` — nuevas acciones
4. `CollectionItemsGrid.tsx` (panel derecho, sin DnD primero)
5. `CollectionTree.tsx` (panel izquierdo, sin DnD primero)
6. `CollectionsModal.tsx` — shell + ambos paneles integrados + cierre
7. DnD — añadir `DndContext`, `useSortable`, `DragOverlay` y `onDragEnd` completo
8. `Shop.tsx` — swap de componente
9. `tsc --noEmit` + `cargo check` final
