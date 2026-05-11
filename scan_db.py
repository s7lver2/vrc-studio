import sqlite3
import os
import glob

# ── 1. Encontrar automáticamente la base de datos ────────────────────────────
def find_database():
    # Buscar en %APPDATA% (Windows)
    appdata = os.environ.get('APPDATA', '')
    if appdata:
        # Posibles ubicaciones relativas comunes en Tauri
        candidates = [
            os.path.join(appdata, 'com.vrcstudio.app', 'vrc-studio.db'),
            os.path.join(appdata, 'vrc-studio', 'vrc-studio.db'),
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        # Búsqueda recursiva en %APPDATA% por si está en una subcarpeta con nombre distinto
        for root, dirs, files in os.walk(appdata):
            for file in files:
                if file == 'vrc-studio.db':
                    return os.path.join(root, file)
    # Si no se encuentra, pedir la ruta manualmente
    manual = input("No se encontró la base de datos automáticamente. Introduce la ruta completa del archivo vrc-studio.db: ")
    return manual.strip()

db_path = find_database()
print(f"Ruta de la base de datos: {db_path}")

if not os.path.exists(db_path):
    print("ERROR: No se pudo acceder a la base de datos.")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# ── 2. Listar tablas ─────────────────────────────────────────────────────────
print("\n=== TABLAS EN LA BASE DE DATOS ===")
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
tables = [row[0] for row in cursor.fetchall()]
for t in tables:
    print(f"  - {t}")

# ── 3. Estructura de inventory_items ─────────────────────────────────────────
print("\n=== COLUMNAS DE inventory_items ===")
cursor.execute("PRAGMA table_info(inventory_items);")
cols = cursor.fetchall()
for col in cols:
    print(f"  {col[1]:30s} {col[2]:10s} nullable={not col[3]} default={col[4]}")

# ── 4. Contar items ──────────────────────────────────────────────────────────
cursor.execute("SELECT COUNT(*) FROM inventory_items;")
count = cursor.fetchone()[0]
print(f"\nTotal de items en inventory_items: {count}")

# ── 5. Primeros 10 items (mostrar campos clave) ──────────────────────────────
print("\n=== PRIMEROS 10 ITEMS (id, name, folder_id, local_path) ===")
try:
    cursor.execute("SELECT id, name, folder_id, local_path FROM inventory_items LIMIT 10;")
    rows = cursor.fetchall()
    for r in rows:
        print(f"  id={r[0]}  name={r[1][:40] if r[1] else 'N/A'}  folder_id={r[2]}  path={r[3][:60] if r[3] else 'N/A'}")
except Exception as e:
    print(f"  ERROR al consultar items: {e}")

# ── 6. Contenido de inventory_folder_items ───────────────────────────────────
print("\n=== CONTENIDO DE inventory_folder_items ===")
cursor.execute("SELECT * FROM inventory_folder_items;")
folder_items = cursor.fetchall()
if folder_items:
    for fi in folder_items:
        print(f"  folder_id={fi[0]}  item_id={fi[1]}")
else:
    print("  (vacío)")

# ── 7. Carpetas ──────────────────────────────────────────────────────────────
print("\n=== CARPETAS (inventory_folders) ===")
cursor.execute("PRAGMA table_info(inventory_folders);")
print("Columnas:", [col[1] for col in cursor.fetchall()])
cursor.execute("SELECT COUNT(*) FROM inventory_folders;")
print(f"Total: {cursor.fetchone()[0]}")
cursor.execute("SELECT id, name, parent_id FROM inventory_folders;")
for row in cursor.fetchall():
    print(f"  id={row[0]}  name={row[1]}  parent_id={row[2]}")

# ── 8. Migraciones aplicadas (sqxlite) ───────────────────────────────────────
print("\n=== MIGRACIONES APLICADAS (_sqlx_migrations) ===")
cursor.execute("SELECT * FROM _sqlx_migrations ORDER BY version;")
for mig in cursor.fetchall():
    print(f"  version={mig[0]}  description={mig[1][:40]}  installed_on={mig[3]}  success={mig[4]}")

conn.close()
print("\nAnálisis completado.")