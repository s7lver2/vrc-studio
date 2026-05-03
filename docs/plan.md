# VRC Studio — Plan de Implementación

> App de escritorio tipo ALCOM/VCC para creadores de avatares de VRChat, construida con Tauri 2 + Rust + React/TypeScript.

---

## Índice

1. [Visión general y stack tecnológico](#1-visión-general-y-stack-tecnológico)
2. [Arquitectura del proyecto](#2-arquitectura-del-proyecto)
3. [Módulo: Proyectos / Avatares](#3-módulo-proyectos--avatares)
4. [Módulo: Packages (paquetes custom)](#4-módulo-packages-paquetes-custom)
5. [Módulo: Shop + Inventory](#5-módulo-shop--inventory)
6. [Módulo: Unity Custom + Optimizaciones](#6-módulo-unity-custom--optimizaciones)
7. [Integración VCS con Git/GitHub](#7-integración-vcs-con-gitgithub)
8. [Configuración global](#8-configuración-global)
9. [Base de datos y persistencia local](#9-base-de-datos-y-persistencia-local)
10. [Fases de implementación](#10-fases-de-implementación)

---

## 1. Visión general y stack tecnológico

### ¿Qué es VRC Studio?

VRC Studio es un gestor de proyectos y herramientas para creadores de avatares de VRChat. Funciona como punto central desde donde el creador puede:

- Crear y gestionar proyectos de Unity para avatares.
- Gestionar paquetes VPM (VRChat Package Manager) propios y del índice oficial.
- Comprar y descargar assets desde Booth.pm y Riperstore Forums.
- Organizar su inventario de assets descargados.
- Opcionalmente usar una versión de Unity modificada con optimizaciones de rendimiento y compilación.
- Controlar versiones de sus proyectos con Git integrado.

### Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework de escritorio | **Tauri 2** |
| Backend / lógica de sistema | **Rust** |
| Frontend / UI | **React 19 + TypeScript** |
| Estilos | **Tailwind CSS + shadcn/ui** |
| Base de datos local | **SQLite** (via `rusqlite` o `sqlx`) |
| Comunicación front↔back | **Tauri Commands + Events** |
| Gestión de paquetes VPM | Implementación propia del protocolo VPM |
| Control de versiones | **`git2-rs`** (bindings Rust para libgit2) |
| Autenticación externa | OAuth2 (Booth, GitHub) |

---

## 2. Arquitectura del proyecto

```
vrc-studio/
├── src-tauri/              # Backend Rust
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/       # Tauri commands expuestos al frontend
│   │   │   ├── projects.rs
│   │   │   ├── packages.rs
│   │   │   ├── shop.rs
│   │   │   ├── inventory.rs
│   │   │   ├── unity.rs
│   │   │   └── vcs.rs
│   │   ├── services/       # Lógica de negocio
│   │   │   ├── vpm.rs          # Gestión VPM/índices
│   │   │   ├── unity_manager.rs
│   │   │   ├── project_builder.rs
│   │   │   ├── booth.rs        # Scraper/API Booth
│   │   │   ├── riperstore.rs   # Scraper Riperstore Forums
│   │   │   ├── downloader.rs   # Gestor de descargas
│   │   │   └── git_service.rs
│   │   ├── db/             # Capa de base de datos
│   │   │   ├── mod.rs
│   │   │   ├── models.rs
│   │   │   └── migrations/
│   │   └── utils/
├── src/                    # Frontend React
│   ├── pages/
│   │   ├── Projects.tsx
│   │   ├── Packages.tsx
│   │   ├── Shop.tsx
│   │   ├── Inventory.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── sidebar/
│   │   ├── wizard/         # Wizard de creación de avatares
│   │   ├── shop/
│   │   └── inventory/
│   ├── hooks/
│   ├── store/              # Estado global (Zustand)
│   └── lib/
│       └── tauri.ts        # Wrappers tipados de invoke()
```

### Comunicación Frontend ↔ Backend

Todos los datos fluyen a través de **Tauri Commands** (funciones Rust invocadas desde JS). Los eventos de larga duración (descargas, compilación, git) se emiten con **Tauri Events** al frontend para mostrar progreso en tiempo real.

```
Frontend invoke("create_project", {...})
     ↓
Rust command → service → filesystem / DB / red
     ↓
emit("project_created", {...}) o return Ok(data)
```

---

## 3. Módulo: Proyectos / Avatares

### 3.1 Vista principal de proyectos

Lista de todos los proyectos de avatar del usuario. Cada proyecto muestra:
- Nombre del proyecto
- Versión de Unity usada
- Última modificación
- Avatar base (si fue seleccionado)
- Estado del VCS (branch actual, cambios pendientes)

Acciones disponibles por proyecto:
- **Abrir en Unity**
- **Abrir carpeta**
- **Añadir paquetes**
- **Duplicar**
- **Editar configuración**
- **Eliminar** (con confirmación)

### 3.2 Wizard de creación de avatar (4 pasos)

#### Paso 1 — Versión de Unity

El usuario elige entre:

- **Unity estándar** (versión oficial compatible con VRChat)
- **Unity custom** (versión modificada por VRC Studio con optimizaciones)

En ambas versiones hay un listado de características opcionales que se pueden activar/desactivar. Cada feature tiene una etiqueta que indica si está disponible solo en custom o en ambas versiones:

| Feature | Estándar | Custom |
|---|---|---|
| Control de versiones Git | ✅ | ✅ |
| Compilación acelerada (TurboCc) | ❌ | ✅ |
| Eliminación de módulos innecesarios | ❌ | ✅ |
| Caché de Shader agresivo | ❌ | ✅ |

Si Unity no está instalado, el wizard ofrece descargarlo e instalarlo automáticamente en este paso.

#### Paso 2 — Configuración del avatar

- **Base del avatar** (opcional): selector de assets del Inventory con tag `BASE_MODEL`. Muestra un grid con preview de los modelos disponibles. Se puede saltar este paso.
- **Shader preferido** (opcional):
  - lilToon
  - Poiyomi Toon
  - Ninguno (por defecto)

#### Paso 3 — Importar paquetes

Vista dividida en dos pestañas:

- **Índice VPM**: paquetes del índice oficial de VRChat y repositorios añadidos por el usuario. Mismo comportamiento que ALCOM.
- **Mis paquetes**: paquetes custom creados en la sección Packages. Se pueden seleccionar para incluirlos en el proyecto.

El usuario puede marcar qué paquetes incluir. Las dependencias se resuelven automáticamente en el backend.

#### Paso 4 — Detalles finales

- Nombre del proyecto
- Directorio de destino (selector de carpeta)
- Resumen de configuración seleccionada
- Botón **"Crear proyecto"**

Al confirmar, el backend:
1. Copia o genera la estructura base del proyecto de Unity.
2. Aplica la versión de Unity seleccionada.
3. Descarga e instala los paquetes VPM seleccionados.
4. Inicializa el repositorio Git si la opción está activa.
5. Abre Unity al terminar (opcional).

Todo el proceso emite eventos de progreso al frontend para mostrar una barra de estado.

---

## 4. Módulo: Packages (paquetes custom)

### 4.1 ¿Qué es un paquete custom?

Un paquete custom es un `.json` compatible con el formato VPM que agrupa uno o más `.unitypackage` o assets del Inventory. Una vez creado, puede importarse en cualquier proyecto igual que un paquete del índice oficial.

### 4.2 Vista de packages

Grid/lista de todos los paquetes custom creados por el usuario. Por cada paquete se muestra:
- Nombre y versión
- Número de assets incluidos
- Proyectos en los que está instalado
- Última modificación

Acciones: **Editar**, **Duplicar**, **Eliminar**, **Exportar como .zip VPM**.

### 4.3 Editor de paquetes

Formulario para crear o editar un paquete:

- **Nombre** (`displayName`)
- **ID** (`name`, ej. `com.miusuario.mipaquete`)
- **Versión** semántica
- **Descripción**
- **Assets incluidos**: selector de items del Inventory (drag & drop o checkbox).
- **Dependencias VPM**: se pueden añadir dependencias de otros paquetes del índice.

El backend genera el `package.json` compatible con VPM y empaqueta los assets en un `.zip` listo para ser referenciado localmente.

### 4.4 Índice local

VRC Studio mantiene un índice VPM local (`local-index.json`) que registra todos los paquetes custom. Este índice se añade automáticamente como repositorio en la configuración de todos los proyectos del usuario.

---

## 5. Módulo: Shop + Inventory

### 5.1 Shop

#### Autenticación

El usuario vincula sus cuentas antes de usar la tienda:
- **Booth.pm**: OAuth2 o sesión por cookie (según disponibilidad de API).
- **Riperstore Forums**: credenciales de foro (usuario + contraseña, sesión guardada en keychain del SO).

Las credenciales se guardan de forma segura en el keychain del sistema operativo (via `keyring` crate).

#### Búsqueda y exploración

- Barra de búsqueda unificada en la parte superior.
- La búsqueda lanza peticiones en paralelo a Booth y a Riperstore, unificando resultados.
- Los resultados se muestran en un **grid de cards** con: imagen, nombre, autor, precio/gratuito, fuente (Booth/Riperstore).
- Filtros: por fuente, por precio (gratis/de pago/comprados), por tipo de asset.

#### Vista de producto

Al hacer clic en un producto:
- Carrusel de imágenes.
- Descripción completa.
- Precio y opciones de compra (redirige a la web si es necesario pagar).
- Si ya está comprado: botón **"Descargar"**.
- Si ya está en el Inventory: indicador de estado.

#### Descarga automática

Al iniciar una descarga:
1. El backend autenticado accede a la URL de descarga real.
2. Descarga el archivo en una carpeta de caché interna.
3. Extrae el contenido si es `.zip`.
4. Registra el item en el Inventory (DB local).
5. Emite progreso en tiempo real al frontend.

### 5.2 Inventory

Vista de todos los assets descargados, organizada como un explorador de archivos con productos en lugar de ficheros.

#### Características

- **Estructura de carpetas virtuales**: el usuario puede crear carpetas y arrastrar productos entre ellas. La organización es virtual (solo en DB), no mueve archivos en disco.
- **Filtros**: por autor, fecha de descarga, tipo de asset, proyectos en los que está instalado, etiquetas (tags).
- **Vista**: grid de cards o lista detallada (toggle).
- **Búsqueda** dentro del inventario.

#### Acciones por item

- **Instalar en proyecto**: selector de proyectos activos del usuario.
- **Abrir carpeta en explorador**.
- **Eliminar**:
  - Solo del Inventory (mantiene archivos en disco y en proyectos Unity).
  - Del Inventory + disco (con advertencia si está en uso en proyectos).
  - Del Inventory + disco + proyectos Unity.
- **Etiquetar** (tags custom).
- **Ver info**: fuente original, fecha, tamaño, proyectos en los que está.

#### Drag & drop

Los items se pueden arrastrar entre carpetas dentro del Inventory. También se pueden arrastrar hacia la vista de un proyecto abierto para instalarlos directamente.

---

## 6. Módulo: Unity Custom + Optimizaciones

### 6.1 Distribución de Unity Custom

VRC Studio mantiene y distribuye una versión de Unity parchada:
- Basada en la versión de Unity requerida por VRChat (actualmente Unity 2022.3.x LTS).
- 100% compatible con el SDK de VRChat y la subida de avatares.
- Los parches se aplican en el proceso de instalación desde el instalador de VRC Studio.

### 6.2 Optimizaciones implementadas

#### Eliminación de módulos innecesarios
Se desactivan o eliminan módulos de Unity que no son necesarios para el flujo de trabajo de avatares VRChat:
- Build targets no necesarios (consolas, móviles, etc.).
- Módulos de analytics internos de Unity.
- Package Manager de Unity simplificado (solo lo necesario para VPM).

#### Compilación acelerada
- Integración de **TurboCc** (compilador C++ acelerado) para reemplazar el compilador por defecto en la compilación de shaders y scripts gestionados donde sea posible.
- Configuración agresiva de caché de Burst Compiler.
- Paralelización máxima en la compilación de scripts.

#### Experiencia general
- Reducción del tiempo de arranque eliminando comprobaciones innecesarias al inicio.
- Simplificación del editor UI para el flujo de trabajo de avatares (ocultando paneles no relevantes por defecto).
- Configuración de memoria de Editor optimizada por defecto.

### 6.3 Instalación y gestión

Desde la pantalla de **Configuración** el usuario puede:
- Ver las versiones de Unity instaladas (estándar y custom).
- Instalar/desinstalar versiones.
- Seleccionar la versión por defecto para nuevos proyectos.
- Cambiar la versión de Unity de un proyecto existente (con asistente de migración).

---

## 7. Integración VCS con Git/GitHub

### 7.1 Disponibilidad

Disponible en **ambas versiones** de Unity (estándar y custom). Se activa como feature opcional en el Paso 1 del wizard de creación.

### 7.2 Backend Git (`git2-rs`)

El backend usa `git2-rs` (bindings de `libgit2`) para todas las operaciones Git, sin necesidad de que el usuario tenga `git` instalado en el sistema.

Operaciones implementadas:
- `init` al crear el proyecto
- `status` (archivos modificados, sin seguimiento, staged)
- `add` (stage de cambios)
- `commit` con mensaje
- `log` (historial de commits)
- `branch` (crear, cambiar, listar)
- `merge` (básico)
- `push` / `pull` (con autenticación GitHub)
- `.gitignore` preconfigurado para proyectos Unity de VRChat

### 7.3 Panel VCS en VRC Studio

Cada proyecto tiene un **panel VCS** accesible desde su vista de detalle:
- Estado actual del repo (branch, cambios pendientes).
- Lista de cambios con diff básico (archivos añadidos/modificados/eliminados).
- Botón de commit rápido (stage all + mensaje + commit).
- Historial de commits con fecha, mensaje y autor.
- Selector de branch y creación de branches.
- Botones de push/pull (si hay remote configurado).

### 7.4 Integración con GitHub

Desde **Configuración** el usuario puede conectar su cuenta de GitHub mediante OAuth2. Una vez conectado:
- Al crear un proyecto con Git activo, puede crear automáticamente un repositorio en GitHub (público o privado).
- Push/pull autenticados sin configuración adicional.
- Desde la vista del proyecto hay un enlace directo al repositorio en GitHub.

### 7.5 Integración en Unity Custom

En la versión de Unity custom, el estado del VCS se muestra directamente en la barra de estado de Unity:
- Branch actual visible en la barra inferior de Unity.
- Indicador de cambios no commiteados.
- Acceso al panel VCS de VRC Studio desde un botón en el menú de Unity.

Esto se implementa mediante un **Unity Editor package** (VPM) instalado automáticamente en proyectos con VCS activo, que se comunica con VRC Studio via un socket local.

---

## 8. Configuración global

La pantalla de **Configuración** incluye:

### General
- Idioma de la interfaz.
- Tema (oscuro / claro / sistema).
- Carpeta por defecto para nuevos proyectos.
- Carpeta de caché / descargas del Shop.

### Unity
- Versiones de Unity instaladas (gestión y descarga).
- Versión por defecto para nuevos proyectos.

### Cuentas vinculadas
- Estado de conexión con Booth.pm (conectar / desconectar).
- Estado de conexión con Riperstore Forums (conectar / desconectar).
- Estado de conexión con GitHub (conectar / desconectar).

### Repositorios VPM
- Lista de repositorios VPM añadidos (URL + nombre).
- Añadir repositorio custom por URL.
- Eliminar repositorios.
- Repositorio oficial de VRChat siempre presente y no eliminable.

### Avanzado
- Limpiar caché de descargas.
- Exportar/importar configuración.
- Logs de la aplicación.

---

## 9. Base de datos y persistencia local

Se usa **SQLite** para toda la persistencia local. El archivo de la base de datos se guarda en el directorio de datos de la app (`AppData` en Windows).

### Tablas principales

```sql
-- Proyectos
projects (id, name, path, unity_version, unity_type, avatar_base_id, shader, created_at, updated_at)

-- Paquetes custom
custom_packages (id, name, display_name, version, description, json_path, zip_path, created_at)

-- Relación paquete → assets
custom_package_assets (package_id, inventory_item_id)

-- Inventory
inventory_items (id, name, author, source, source_id, local_path, download_date, size_bytes, tags)

-- Carpetas virtuales del Inventory
inventory_folders (id, name, parent_id)
inventory_folder_items (folder_id, item_id)

-- Assets instalados en proyectos
project_assets (project_id, inventory_item_id, installed_at)

-- Repositorios VPM
vpm_repositories (id, name, url, last_fetched, json_cache)

-- Cuentas vinculadas (tokens cifrados)
linked_accounts (provider, token_encrypted, username, expires_at)
```

### Migraciones

Las migraciones se gestionan con `sqlx` migrations o `rusqlite_migration`, aplicándose automáticamente al arrancar la app si la versión del schema es inferior a la esperada.

---

## 10. Fases de implementación

### Fase 0 — Scaffolding (1–2 semanas)
- Inicializar proyecto Tauri 2 + React/TS + Tailwind.
- Configurar estructura de carpetas (ver sección 2).
- Configurar SQLite y primera migración.
- Layout base: sidebar con navegación entre secciones.
- Sistema de Tauri Commands tipado con wrappers en `src/lib/tauri.ts`.

### Fase 1 — Gestión de proyectos MVP (3–4 semanas)
- Vista principal de proyectos (lista + acciones básicas).
- Wizard de creación de avatar (4 pasos, funcional).
- Integración con Unity: detección de instalaciones, apertura de proyectos.
- Gestor VPM básico: leer índice oficial de VRChat, resolver dependencias, instalar paquetes.
- Creación real de proyectos Unity en disco.

### Fase 2 — Packages custom (2 semanas)
- Vista de packages y editor de paquetes.
- Generación de `package.json` VPM y `.zip` desde assets del Inventory.
- Índice VPM local y su integración en el wizard (Paso 3).

### Fase 3 — Shop e Inventory (4–5 semanas)
- Sistema de autenticación: Booth.pm y Riperstore Forums.
- Scraper / cliente API para ambas plataformas.
- Motor de búsqueda unificado.
- Grid de productos y vista de detalle.
- Gestor de descargas con progreso en tiempo real.
- Vista de Inventory con carpetas virtuales, filtros y drag & drop.
- Acciones de eliminación (3 modos).

### Fase 4 — VCS Git/GitHub (2–3 semanas)
- Integración `git2-rs`: init, status, add, commit, log, branch.
- Panel VCS en la vista de proyecto.
- Autenticación GitHub OAuth2.
- Push/pull con GitHub.
- Unity Editor package para mostrar estado VCS en Unity Custom.

### Fase 5 — Unity Custom (3–4 semanas)
- Pipeline de parcheo/instalación de Unity Custom.
- Integración TurboCc para compilación acelerada.
- Eliminación de módulos no necesarios.
- Optimizaciones de arranque y configuración por defecto.
- Verificación de compatibilidad 100% con SDK de VRChat.

### Fase 6 — Pulido y QA (2–3 semanas)
- Testing end-to-end del flujo completo de creación de avatar.
- Prueba de subida de avatares a VRChat desde proyectos creados con VRC Studio.
- Ajustes de rendimiento del frontend.
- Manejo robusto de errores y mensajes de usuario.
- Onboarding para usuarios nuevos (primera ejecución).

---

*Este documento es un plan vivo. Cada sección se irá detallando técnicamente a medida que se entra en su fase de implementación.*
