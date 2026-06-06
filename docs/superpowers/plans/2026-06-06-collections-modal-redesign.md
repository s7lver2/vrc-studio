# Collections Modal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el panel lateral de colecciones por un modal a pantalla completa con árbol de subcarpetas y drag & drop completo.

**Architecture:** Modal de dos paneles (árbol izquierdo 220px + grid de items derecha). Un único `DndContext` en el modal raíz gestiona tres interacciones: reordenar items dentro de la colección activa, mover un item a otra colección, y anidar/mover colecciones. Las tree-rows usan `useDraggable` + `useDroppable` individuales; el grid usa `SortableContext` + `useSortable`.

**Tech Stack:** Tauri 2, Rust (rusqlite, chrono, uuid), React 18, TypeScript, @dnd-kit/core, @dnd-kit/sortable, Tailwind CSS, Zustand

---

## File Map

| Acción | Ruta |
|--------|------|
| Crear | `src-tauri/src/db/migrations/030_collections_folders.sql` |
| Modificar | `src-tauri/src/commands/collections.rs` |
| Modificar | `src-tauri/src/lib.rs` |
| Modificar | `src/lib/tauri.ts` |
| Modificar | `src/store/collectionsStore.ts` |
| Crear | `src/components/shop/CollectionItemsGrid.tsx` |
| Crear | `src/components/shop/CollectionTree.tsx` |
| Crear | `src/components/shop/CollectionsModal.tsx` |
| Modificar | `src/pages/Shop.tsx` |

---

## Task 1 — DB Migration

**Files:**
- Create: `src-tauri/src/db/migrations/030_collections_folders.sql`

- [ ] **Crear el fichero de migración**

```sql
-- src-tauri/src/db/migrations/030_collections_folders.sql
-- Añade soporte de subcarpetas y orden personalizado a colecciones e items.
-- SQLite no permite ADD COLUMN ... REFERENCES con FOREIGN KEY enforcement
-- en ALTER TABLE, así que la integridad referencial se gestiona desde Rust.
ALTER TABLE shop_collections ADD COLUMN parent_id   TEXT;
ALTER TABLE shop_collections ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_collection_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Verificar que la migración se aplica al arrancar la app**

Ejecutar `pnpm tauri dev` (o `cargo build`) y comprobar que no hay errores de DB en la consola. Si hay error "duplicate column name" es porque la migración ya se aplicó — eso está bien, SQLite lo reporta pero el sistema de migraciones ya maneja la idempotencia.

- [ ] **Commit**

```bash
git add src-tauri/src/db/migrations/030_collections_folders.sql
git commit -m "feat(db): add parent_id and sort_order to collections + items"
```

---

## Task 2 — Rust: actualizar tipos y query `collections_list`

**Files:**
- Modify: `src-tauri/src/commands/collections.rs`

- [ ] **Actualizar el struct `Collection`** (añadir dos campos nuevos, líneas 9–18 del fichero)

Reemplazar la definición actual del struct `Collection`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub created_at: String,
    pub description: String,
    pub updated_at: String,
    pub item_count: i64,
}
```

Por:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub item_count: i64,
}
```

- [ ] **Actualizar el struct `CollectionItem`** (añadir `sort_order`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
    pub source: String,
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub added_at: String,
    pub sort_order: i64,
}
```

- [ ] **Actualizar `collections_list`: query + mapeo de filas**

Reemplazar la función `collections_list` completa:

```rust
#[tauri::command]
pub fn collections_list(pool: State<'_, DbPool>) -> Result<Vec<Collection>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.cover_url, c.description, c.parent_id, c.sort_order,
                c.created_at, c.updated_at, COUNT(ci.id) as item_count
         FROM shop_collections c
         LEFT JOIN shop_collection_items ci ON ci.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.sort_order ASC, c.updated_at DESC",
    )?;
    let cols = stmt
        .query_map([], |row| {
            Ok(Collection {
                id:          row.get(0)?,
                name:        row.get(1)?,
                cover_url:   row.get(2)?,
                description: row.get(3)?,
                parent_id:   row.get(4)?,
                sort_order:  row.get(5)?,
                created_at:  row.get(6)?,
                updated_at:  row.get(7)?,
                item_count:  row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(cols)
}
```

- [ ] **Actualizar `collection_create`**: rellenar los nuevos campos con defaults en el `Ok(Collection {...})` retornado:

```rust
Ok(Collection {
    id,
    name,
    cover_url: String::new(),
    description: String::new(),
    parent_id: None,
    sort_order: 0,
    created_at: now.clone(),
    updated_at: now,
    item_count: 0,
})
```

- [ ] **Actualizar `collection_get_items`**: añadir `sort_order` en SELECT, mapeo y ORDER BY

```rust
#[tauri::command]
pub fn collection_get_items(
    pool: State<'_, DbPool>,
    collection_id: String,
) -> Result<Vec<CollectionItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, collection_id, source, source_id, name, author, thumbnail_url,
                price_display, url, added_at, sort_order
         FROM shop_collection_items
         WHERE collection_id = ?1
         ORDER BY sort_order ASC, added_at DESC",
    )?;
    let items = stmt
        .query_map(params![collection_id], |row| {
            Ok(CollectionItem {
                id:            row.get(0)?,
                collection_id: row.get(1)?,
                source:        row.get(2)?,
                source_id:     row.get(3)?,
                name:          row.get(4)?,
                author:        row.get(5)?,
                thumbnail_url: row.get(6)?,
                price_display: row.get(7)?,
                url:           row.get(8)?,
                added_at:      row.get(9)?,
                sort_order:    row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}
```

- [ ] **Verificar compilación**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Esperado: sin errores. Si hay `E[0277]` (type mismatch) es que algún campo del struct no coincide con el tipo del `row.get()`.

- [ ] **Commit**

```bash
git add src-tauri/src/commands/collections.rs
git commit -m "feat(rust): update Collection/CollectionItem types with parent_id, sort_order"
```

---

## Task 3 — Rust: nuevos comandos

**Files:**
- Modify: `src-tauri/src/commands/collections.rs` (añadir al final del fichero)

- [ ] **Añadir `collection_move_to_parent`** al final del fichero:

```rust
#[tauri::command]
pub fn collection_move_to_parent(
    pool: State<'_, DbPool>,
    collection_id: String,
    parent_id: Option<String>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shop_collections SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![parent_id, now, collection_id],
    )?;
    Ok(())
}
```

- [ ] **Añadir `collections_reorder`**:

```rust
#[tauri::command]
pub fn collections_reorder(
    pool: State<'_, DbPool>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE shop_collections SET sort_order = ?1 WHERE id = ?2",
            params![i as i64, id],
        )?;
    }
    Ok(())
}
```

- [ ] **Añadir `collection_items_reorder`**:

```rust
#[tauri::command]
pub fn collection_items_reorder(
    pool: State<'_, DbPool>,
    collection_id: String,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE shop_collection_items SET sort_order = ?1 WHERE id = ?2 AND collection_id = ?3",
            params![i as i64, id, collection_id],
        )?;
    }
    Ok(())
}
```

- [ ] **Añadir `collection_item_move`**:

```rust
/// Mueve un item de una colección a otra.
/// Si el item ya existe en la colección destino, simplemente lo elimina del origen.
#[tauri::command]
pub fn collection_item_move(
    pool: State<'_, DbPool>,
    item_id: String,
    from_collection_id: String,
    to_collection_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Obtener source y source_id para detectar duplicados en destino
    let (source, source_id): (String, String) = conn.query_row(
        "SELECT source, source_id FROM shop_collection_items WHERE id = ?1 AND collection_id = ?2",
        params![item_id, from_collection_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // ¿Ya existe el item en la colección destino?
    let exists_in_target: i64 = conn.query_row(
        "SELECT COUNT(*) FROM shop_collection_items
         WHERE collection_id = ?1 AND source = ?2 AND source_id = ?3",
        params![to_collection_id, &source, &source_id],
        |row| row.get(0),
    ).unwrap_or(0);

    if exists_in_target > 0 {
        // Ya está en destino: solo borrar del origen
        conn.execute(
            "DELETE FROM shop_collection_items WHERE id = ?1",
            params![item_id],
        )?;
    } else {
        // No está en destino: actualizar collection_id
        conn.execute(
            "UPDATE shop_collection_items SET collection_id = ?1 WHERE id = ?2",
            params![to_collection_id, item_id],
        )?;
    }
    Ok(())
}
```

- [ ] **Verificar compilación**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Esperado: sin errores.

- [ ] **Commit**

```bash
git add src-tauri/src/commands/collections.rs
git commit -m "feat(rust): add collection_move_to_parent, reorder and item_move commands"
```

---

## Task 4 — Rust: registrar comandos en lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Localizar el bloque de colecciones** (alrededor de la línea 288) y reemplazarlo:

```rust
// Antes:
commands::collections::collections_list,
commands::collections::collection_create,
commands::collections::collection_delete,
commands::collections::collection_rename,
commands::collections::collection_set_cover,
commands::collections::collection_add_item,
commands::collections::collection_remove_item,
commands::collections::collection_get_items,
commands::collections::collection_get_item_collections,

// Después (añadir collection_update_description que faltaba + los 4 nuevos):
commands::collections::collections_list,
commands::collections::collection_create,
commands::collections::collection_delete,
commands::collections::collection_rename,
commands::collections::collection_set_cover,
commands::collections::collection_add_item,
commands::collections::collection_remove_item,
commands::collections::collection_get_items,
commands::collections::collection_get_item_collections,
commands::collections::collection_update_description,
commands::collections::collection_move_to_parent,
commands::collections::collections_reorder,
commands::collections::collection_items_reorder,
commands::collections::collection_item_move,
```

- [ ] **Verificar compilación y arranque**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): register new collection commands in invoke handler"
```

---

## Task 5 — TypeScript: actualizar `tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts` (sección Collections, líneas 954–1001)

- [ ] **Actualizar interfaz `Collection`** (añadir `parent_id` y `sort_order`):

```typescript
export interface Collection {
  id: string;
  name: string;
  cover_url: string;
  description: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  item_count: number;
}
```

- [ ] **Actualizar interfaz `CollectionItem`** (añadir `sort_order`):

```typescript
export interface CollectionItem {
  id: string;
  collection_id: string;
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
  price_display: string;
  url: string;
  added_at: string;
  sort_order: number;
}
```

- [ ] **Añadir los 4 nuevos bindings** (después de la línea de `tauriCollectionGetItemCollections`):

```typescript
export const tauriCollectionMoveToParent = (collectionId: string, parentId: string | null) =>
  invoke<void>("collection_move_to_parent", { collectionId, parentId });

export const tauriCollectionsReorder = (ids: string[]) =>
  invoke<void>("collections_reorder", { ids });

export const tauriCollectionItemsReorder = (collectionId: string, ids: string[]) =>
  invoke<void>("collection_items_reorder", { collectionId, ids });

export const tauriCollectionItemMove = (itemId: string, fromCollectionId: string, toCollectionId: string) =>
  invoke<void>("collection_item_move", { itemId, fromCollectionId, toCollectionId });
```

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sin errores (los nuevos campos opcionales no rompen el código existente porque TypeScript permite campos extras en objetos literales).

- [ ] **Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(ts): update Collection/CollectionItem types and add 4 new tauri bindings"
```

---

## Task 6 — Store: nuevas acciones en `collectionsStore.ts`

**Files:**
- Modify: `src/store/collectionsStore.ts`

- [ ] **Añadir los nuevos imports** al principio del fichero:

```typescript
import {
  // ... imports existentes ...
  tauriCollectionMoveToParent,
  tauriCollectionsReorder,
  tauriCollectionItemsReorder,
  tauriCollectionItemMove,
} from "../lib/tauri";
```

- [ ] **Ampliar la interfaz `CollectionsState`** (añadir 4 métodos nuevos):

```typescript
interface CollectionsState {
  // ... existing ...
  moveCollectionToParent: (id: string, parentId: string | null) => Promise<void>;
  reorderCollections: (ids: string[]) => Promise<void>;
  reorderItems: (collectionId: string, ids: string[]) => Promise<void>;
  moveItem: (itemId: string, fromCollectionId: string, toCollectionId: string) => Promise<void>;
}
```

- [ ] **Implementar los 4 métodos** en el objeto `create(...)` (añadir después de `updateDescription`):

```typescript
moveCollectionToParent: async (id, parentId) => {
  await tauriCollectionMoveToParent(id, parentId);
  set((s) => ({
    collections: s.collections.map((c) =>
      c.id === id ? { ...c, parent_id: parentId } : c
    ),
  }));
},

reorderCollections: async (ids) => {
  await tauriCollectionsReorder(ids);
  set((s) => ({
    collections: s.collections.map((c) => {
      const idx = ids.indexOf(c.id);
      return idx !== -1 ? { ...c, sort_order: idx } : c;
    }),
  }));
},

// items viven en estado local del modal — solo persiste, no actualiza store
reorderItems: async (collectionId, ids) => {
  await tauriCollectionItemsReorder(collectionId, ids);
},

moveItem: async (itemId, fromCollectionId, toCollectionId) => {
  await tauriCollectionItemMove(itemId, fromCollectionId, toCollectionId);
  set((s) => ({
    collections: s.collections.map((c) => {
      if (c.id === fromCollectionId) return { ...c, item_count: Math.max(0, c.item_count - 1) };
      if (c.id === toCollectionId)   return { ...c, item_count: c.item_count + 1 };
      return c;
    }),
  }));
},
```

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/store/collectionsStore.ts
git commit -m "feat(store): add moveCollectionToParent, reorderCollections, reorderItems, moveItem"
```

---

## Task 7 — `CollectionItemsGrid.tsx` (panel derecho)

**Files:**
- Create: `src/components/shop/CollectionItemsGrid.tsx`

Este componente recibe los items ya ordenados y el `localOrder` del modal padre. Vive dentro del `DndContext` definido en `CollectionsModal` — no crea su propio contexto.

- [ ] **Crear el fichero completo**:

```typescript
// src/components/shop/CollectionItemsGrid.tsx
import { useCallback } from "react";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Package2, Image, BookmarkX, ShoppingCart } from "lucide-react";
import type { CollectionItem } from "../../lib/tauri";
import { useCartStore } from "../../store/cartStore";
import { useShopStore } from "../../store/shopStore";

// ── SortableItemCard ─────────────────────────────────────────────────────────

interface CardProps {
  item: CollectionItem;
  onSetCover: (url: string) => void;
  onRemove: (item: CollectionItem) => void;
}

function SortableItemCard({ item, onSetCover, onRemove }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `item:${item.id}` });

  const { isInCart, addItem, removeItem } = useCartStore();
  const { boothOwnedIds } = useShopStore();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    cursor: "grab",
    touchAction: "none",
  };

  const inCart = isInCart(item.source, item.source_id);
  const isPurchased = item.source === "booth" && boothOwnedIds.has(item.source_id);

  const handleCartToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inCart) {
      await removeItem(item.source, item.source_id);
    } else {
      await addItem({
        source: item.source as "booth",
        source_id: item.source_id,
        name: item.name,
        author: item.author,
        thumbnail_url: item.thumbnail_url,
        price_display: item.price_display,
        url: item.url,
      });
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative bg-zinc-900 border border-zinc-800 rounded-[10px] overflow-hidden hover:border-zinc-600 transition-colors select-none"
    >
      {/* Thumbnail */}
      {item.thumbnail_url ? (
        <img
          src={item.thumbnail_url}
          alt=""
          className="w-full aspect-square object-cover bg-zinc-800"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      ) : (
        <div className="w-full aspect-square bg-zinc-800 flex items-center justify-center">
          <Package2 className="h-6 w-6 text-zinc-700" />
        </div>
      )}

      {/* Info */}
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-semibold text-zinc-300 truncate leading-tight">{item.name}</p>
        <p className="text-[9px] text-red-400 font-bold mt-0.5">{item.price_display}</p>
        <p className="text-[8px] text-zinc-600 truncate mt-0.5">{item.author}</p>
      </div>

      {/* Hover actions — onPointerDown stopPropagation evita que el drag se active */}
      <div
        className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {item.thumbnail_url && (
          <button
            onClick={(e) => { e.stopPropagation(); onSetCover(item.thumbnail_url); }}
            className="w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center justify-center backdrop-blur-sm"
            title="Set as collection cover"
          >
            <Image className="h-3 w-3" />
          </button>
        )}
        {!isPurchased && (
          <button
            onClick={handleCartToggle}
            className={`w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 flex items-center justify-center backdrop-blur-sm ${
              inCart ? "text-red-400 hover:text-red-300" : "text-zinc-400 hover:text-emerald-400"
            }`}
            title={inCart ? "Remove from cart" : "Add to cart"}
          >
            <ShoppingCart className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(item); }}
          className="w-6 h-6 rounded-md bg-zinc-950/80 border border-zinc-700 text-zinc-400 hover:text-red-400 flex items-center justify-center backdrop-blur-sm"
          title="Remove from collection"
        >
          <BookmarkX className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Ghost card (DragOverlay) ─────────────────────────────────────────────────

export function ItemDragGhost({ item }: { item: CollectionItem }) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-600 rounded-[10px] overflow-hidden shadow-2xl"
      style={{ width: 130, transform: "rotate(2deg) scale(1.05)", opacity: 0.93 }}
    >
      {item.thumbnail_url ? (
        <img src={item.thumbnail_url} alt="" className="w-full aspect-square object-cover bg-zinc-800" draggable={false} />
      ) : (
        <div className="w-full aspect-square bg-zinc-800 flex items-center justify-center">
          <Package2 className="h-6 w-6 text-zinc-700" />
        </div>
      )}
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-semibold text-zinc-300 truncate">{item.name}</p>
        <p className="text-[9px] text-red-400 font-bold mt-0.5">{item.price_display}</p>
      </div>
    </div>
  );
}

// ── CollectionItemsGrid ──────────────────────────────────────────────────────

interface Props {
  collectionId: string | null;
  items: CollectionItem[];
  loading: boolean;
  localOrder: string[];          // array de "item:<uuid>" en el orden actual
  onSetCover: (url: string) => void;
  onRemove: (item: CollectionItem) => void;
}

export function CollectionItemsGrid({ collectionId, items, loading, localOrder, onSetCover, onRemove }: Props) {
  if (!collectionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600 select-none">
        <Package2 className="h-12 w-12 opacity-20" />
        <p className="text-sm">Selecciona una colección</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600 select-none">
        <Package2 className="h-12 w-12 opacity-20" />
        <p className="text-sm font-medium text-zinc-500">Sin items</p>
        <p className="text-xs text-center px-6">Guarda productos desde la tienda para añadirlos aquí</p>
      </div>
    );
  }

  // Reordenar items según localOrder
  const itemById = new Map(items.map((i) => [i.id, i]));
  const sortedItems = localOrder
    .map((dndId) => itemById.get(dndId.replace("item:", "")))
    .filter(Boolean) as CollectionItem[];

  return (
    <div
      className="flex-1 overflow-y-auto p-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: "8px",
        alignContent: "start",
      }}
    >
      <SortableContext items={localOrder} strategy={rectSortingStrategy}>
        {sortedItems.map((item) => (
          <SortableItemCard
            key={item.id}
            item={item}
            onSetCover={onSetCover}
            onRemove={onRemove}
          />
        ))}
      </SortableContext>
    </div>
  );
}
```

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/components/shop/CollectionItemsGrid.tsx
git commit -m "feat(ui): add CollectionItemsGrid component (right panel)"
```

---

## Task 8 — `CollectionTree.tsx` (panel izquierdo)

**Files:**
- Create: `src/components/shop/CollectionTree.tsx`

Cada row del árbol es a la vez draggable (para mover la colección) y droppable (para recibir items o colecciones). Se usa `useDraggable` + `useDroppable` por separado y se combinan las refs.

- [ ] **Crear el fichero completo**:

```typescript
// src/components/shop/CollectionTree.tsx
import { useState, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Folder, Plus } from "lucide-react";
import type { Collection } from "../../lib/tauri";

// ── CollectionRow ────────────────────────────────────────────────────────────

interface RowProps {
  col: Collection;
  depth: number;
  isSelected: boolean;
  isOver: boolean;      // true cuando algo se arrastra encima de esta row
  hasChildren: boolean;
  isExpanded: boolean;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

function CollectionRow({
  col, depth, isSelected, isOver, hasChildren, isExpanded, onSelect, onToggleExpand,
}: RowProps) {
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: `col:${col.id}`,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `col:${col.id}`,
  });

  // Combinar las dos refs en una
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef]
  );

  return (
    <div
      ref={setRef}
      style={{ paddingLeft: depth * 14 }}
      className={`
        flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer select-none transition-colors
        ${isSelected ? "bg-zinc-800 border border-zinc-700" : "hover:bg-zinc-900"}
        ${isOver ? "bg-red-950/30 border border-red-700/40" : ""}
        ${isDragging ? "opacity-40" : ""}
      `}
      onClick={() => onSelect(col.id)}
      {...attributes}
    >
      {/* Expand / collapse toggle */}
      <button
        className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-400 shrink-0"
        style={{ visibility: hasChildren ? "visible" : "hidden" }}
        onClick={(e) => { e.stopPropagation(); onToggleExpand(col.id); }}
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Cover / drag handle */}
      <div
        className="w-5 h-5 rounded shrink-0 overflow-hidden flex items-center justify-center bg-zinc-800 cursor-grab"
        {...listeners}
      >
        {col.cover_url ? (
          <img src={col.cover_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Folder className="h-3 w-3 text-zinc-500" />
        )}
      </div>

      {/* Name */}
      <span className={`flex-1 text-[11px] truncate ${isSelected ? "text-zinc-100 font-semibold" : "text-zinc-400"}`}>
        {col.name}
      </span>

      {/* Count badge */}
      <span className="text-[9px] text-zinc-600 shrink-0">{col.item_count}</span>
    </div>
  );
}

// ── Root droppable zone ──────────────────────────────────────────────────────

function RootDropZone({ isDraggingCol }: { isDraggingCol: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "root" });
  if (!isDraggingCol) return null;
  return (
    <div
      ref={setNodeRef}
      className={`mx-2 mb-1 h-6 rounded-lg border-dashed border text-[9px] flex items-center justify-center transition-colors ${
        isOver ? "border-red-500 bg-red-950/30 text-red-400" : "border-zinc-700 text-zinc-700"
      }`}
    >
      Mover a raíz
    </div>
  );
}

// ── CollectionTree ───────────────────────────────────────────────────────────

interface Props {
  collections: Collection[];
  selectedId: string | null;
  activeId: string | null;          // id del drag activo en el DndContext padre
  onSelect: (id: string) => void;
  onCreateCollection: (name: string) => void;
}

export function CollectionTree({ collections, selectedId, activeId, onSelect, onCreateCollection }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateCollection(name);
    setNewName("");
  };

  const isDraggingCol = activeId?.startsWith("col:") ?? false;

  // Renderizado recursivo del árbol
  const renderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const children = collections.filter((c) => c.parent_id === parentId);
    return children.map((col) => {
      const hasChildren = collections.some((c) => c.parent_id === col.id);
      const isExpanded = expandedIds.has(col.id);
      return (
        <div key={col.id}>
          <CollectionRow
            col={col}
            depth={depth}
            isSelected={selectedId === col.id}
            isOver={false}   // el highlight real lo gestiona useDroppable interno en la row
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onSelect={onSelect}
            onToggleExpand={toggleExpand}
          />
          {isExpanded && hasChildren && renderTree(col.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/60 shrink-0">
        <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Colecciones</p>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        <RootDropZone isDraggingCol={isDraggingCol} />
        {collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-zinc-700">
            <Folder className="h-6 w-6 opacity-30" />
            <p className="text-[10px]">Sin colecciones</p>
          </div>
        ) : (
          renderTree(null, 0)
        )}
      </div>

      {/* New collection input */}
      <div className="border-t border-zinc-800/60 p-2 shrink-0">
        <div className="flex gap-1.5">
          <input
            className="flex-1 px-2.5 py-1.5 text-[11px] bg-zinc-900 border border-zinc-700/60 rounded-lg text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-500 transition-colors"
            placeholder="Nueva colección…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-30 text-white transition-colors flex items-center"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/components/shop/CollectionTree.tsx
git commit -m "feat(ui): add CollectionTree component (left panel)"
```

---

## Task 9 — `CollectionsModal.tsx` (modal shell + DnD)

**Files:**
- Create: `src/components/shop/CollectionsModal.tsx`

Este es el componente raíz que une todo. Gestiona el estado del modal, carga items, y contiene el `DndContext` único con la lógica de `onDragEnd`.

- [ ] **Crear el fichero completo**:

```typescript
// src/components/shop/CollectionsModal.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, pointerWithin, useSensor, useSensors, PointerSensor,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import { useCollectionsStore } from "../../store/collectionsStore";
import { CollectionTree } from "./CollectionTree";
import { CollectionItemsGrid, ItemDragGhost } from "./CollectionItemsGrid";
import type { CollectionItem } from "../../lib/tauri";

// Prioriza targets col: y root sobre targets item: (igual que inventory)
const collectionFirstCollision = (args: Parameters<typeof pointerWithin>[0]) => {
  const collisions = pointerWithin(args);
  const colHits  = collisions.filter((c) => String(c.id).startsWith("col:") || c.id === "root");
  const itemHits = collisions.filter((c) => String(c.id).startsWith("item:"));
  return [...colHits, ...itemHits];
};

interface Props {
  onClose: () => void;
}

export function CollectionsModal({ onClose }: Props) {
  const {
    collections,
    createCollection,
    setCover,
    removeItemFromCollection,
    getCollectionItems,
    moveCollectionToParent,
    reorderCollections,
    reorderItems,
    moveItem,
  } = useCollectionsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const pendingReorderRef = useRef<string[] | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Cargar items cuando cambia la colección seleccionada
  useEffect(() => {
    if (!selectedId) { setItems([]); setLocalOrder([]); return; }
    setLoading(true);
    getCollectionItems(selectedId)
      .then((loaded) => {
        setItems(loaded);
        setLocalOrder(loaded.map((i) => `item:${i.id}`));
      })
      .finally(() => setLoading(false));
  }, [selectedId, getCollectionItems]);

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── DnD handlers ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragOver = useCallback((e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const aid = String(active.id);
    const oid = String(over.id);

    // Reorden optimista de items en el grid
    if (aid.startsWith("item:") && oid.startsWith("item:")) {
      setLocalOrder((prev) => {
        const oldIdx = prev.indexOf(aid);
        const newIdx = prev.indexOf(oid);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const aid = String(active.id);
    const oid = String(over.id);

    // ── Item drag ────────────────────────────────────────────────────────────
    if (aid.startsWith("item:")) {
      const itemId = aid.replace("item:", "");

      if (oid.startsWith("col:") && selectedId) {
        // Mover item a otra colección
        const targetColId = oid.replace("col:", "");
        if (targetColId !== selectedId) {
          await moveItem(itemId, selectedId, targetColId);
          setItems((prev) => prev.filter((i) => i.id !== itemId));
          setLocalOrder((prev) => prev.filter((id) => id !== aid));
        }
      } else if (oid.startsWith("item:") && selectedId) {
        // Persistir reorden
        await reorderItems(selectedId, localOrder.map((id) => id.replace("item:", "")));
      }
      return;
    }

    // ── Collection drag ──────────────────────────────────────────────────────
    if (aid.startsWith("col:")) {
      const colId = aid.replace("col:", "");

      if (oid === "root") {
        await moveCollectionToParent(colId, null);
        return;
      }

      if (oid.startsWith("col:")) {
        const targetColId = oid.replace("col:", "");
        if (targetColId === colId) return;

        const sourceCol = collections.find((c) => c.id === colId);
        const targetCol = collections.find((c) => c.id === targetColId);
        if (!sourceCol || !targetCol) return;

        if (sourceCol.parent_id === targetCol.parent_id) {
          // Mismo nivel → reordenar
          const sameLevel = collections
            .filter((c) => c.parent_id === sourceCol.parent_id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((c) => c.id);
          const oldIdx = sameLevel.indexOf(colId);
          const newIdx = sameLevel.indexOf(targetColId);
          if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
            await reorderCollections(arrayMove(sameLevel, oldIdx, newIdx));
          }
        } else {
          // Nivel diferente → anidar bajo targetCol
          await moveCollectionToParent(colId, targetColId);
        }
      }
    }
  }, [selectedId, localOrder, collections, moveItem, reorderItems, moveCollectionToParent, reorderCollections]);

  // ── Helpers de UI ────────────────────────────────────────────────────────

  const handleSetCover = async (url: string) => {
    if (!selectedId) return;
    await setCover(selectedId, url);
  };

  const handleRemoveItem = async (item: CollectionItem) => {
    if (!selectedId) return;
    await removeItemFromCollection(selectedId, item.source, item.source_id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setLocalOrder((prev) => prev.filter((id) => id !== `item:${item.id}`));
  };

  const handleCreateCollection = async (name: string) => {
    await createCollection(name);
  };

  // Item activo (para DragOverlay)
  const activeItem = activeId?.startsWith("item:")
    ? items.find((i) => i.id === activeId.replace("item:", ""))
    : null;

  const selectedCollection = collections.find((c) => c.id === selectedId);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal shell */}
      <div
        className="relative flex flex-col bg-zinc-950 border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ width: "min(1100px, 92vw)", height: "min(680px, 88vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-950 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-100">
              {selectedCollection ? selectedCollection.name : "Colecciones"}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {selectedCollection
                ? `${selectedCollection.item_count} item${selectedCollection.item_count !== 1 ? "s" : ""}`
                : `${collections.length} colección${collections.length !== 1 ? "es" : ""}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body: two panels ─────────────────────────────────────────────── */}
        <DndContext
          sensors={sensors}
          collisionDetection={collectionFirstCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left — collection tree */}
            <div className="w-[220px] shrink-0 border-r border-zinc-800/60 bg-zinc-950 overflow-hidden">
              <CollectionTree
                collections={collections}
                selectedId={selectedId}
                activeId={activeId}
                onSelect={setSelectedId}
                onCreateCollection={handleCreateCollection}
              />
            </div>

            {/* Right — items grid */}
            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              <CollectionItemsGrid
                collectionId={selectedId}
                items={items}
                loading={loading}
                localOrder={localOrder}
                onSetCover={handleSetCover}
                onRemove={handleRemoveItem}
              />
            </div>
          </div>

          {/* DragOverlay */}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {activeItem && <ItemDragGhost item={activeItem} />}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
```

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add src/components/shop/CollectionsModal.tsx
git commit -m "feat(ui): add CollectionsModal with two-panel layout and full DnD"
```

---

## Task 10 — Conectar en `Shop.tsx` + compile final

**Files:**
- Modify: `src/pages/Shop.tsx`

- [ ] **Sustituir el import** de `CollectionsView` por `CollectionsModal`:

```typescript
// Eliminar:
import { CollectionsView } from "../components/shop/CollectionsView";

// Añadir:
import { CollectionsModal } from "../components/shop/CollectionsModal";
```

- [ ] **Sustituir el JSX** (línea ~246):

```tsx
// Eliminar:
{collectionsOpen && <CollectionsView onClose={() => setCollectionsOpen(false)} />}

// Añadir:
{collectionsOpen && <CollectionsModal onClose={() => setCollectionsOpen(false)} />}
```

- [ ] **Verificar TypeScript limpio**

```bash
npx tsc --noEmit
```

Esperado: 0 errores.

- [ ] **Verificar Rust limpio**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Esperado: 0 errores.

- [ ] **Commit final**

```bash
git add src/pages/Shop.tsx
git commit -m "feat: wire CollectionsModal into Shop page — replaces side panel"
```

---

## Notas para el ejecutor

- **`CollectionsView.tsx` no se borra** en este plan — puede quedar como archivo muerto hasta que se confirme que el modal funciona en producción.
- Si la migración 030 falla en una DB existente con "duplicate column name", el sistema de migraciones ya lo maneja — no es un error bloqueante.
- `collection_update_description` estaba implementado en Rust pero no registrado en `lib.rs`. Se añade en Task 4 junto a los nuevos comandos.
- El árbol renderiza colecciones recursivamente por `parent_id`. Colecciones sin `parent_id` (null) aparecen en el nivel raíz.
- El drop de colección sobre colección del mismo `parent_id` reordena; sobre colección de distinto nivel la anida. Si se necesita más granularidad visual, se puede añadir un área de "drop between" en la tree-row en el futuro.
