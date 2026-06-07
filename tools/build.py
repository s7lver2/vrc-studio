#!/usr/bin/env python3
"""
build.py — VRC Studio Build System
=====================================
Ubicación: tools/build.py
Ejecutar desde la raíz del proyecto:  python tools/build.py

Modos:
  python tools/build.py              Abre la app en modo dev con HMR (tauri dev)
  python tools/build.py --quick      Build debug compilado + copia directa (sin wizard)
  python tools/build.py clean        Limpia dist/ y releases/
  python tools/build.py clean --deep También limpia target/ y node_modules/
  python tools/build.py release                        Build todas las plataformas
  python tools/build.py release --version 1.2.3        Fuerza versión explícita
  python tools/build.py release --version 1.2.3 --no-publish  Solo compilar y firmar
  python tools/build.py release --version 1.2.3 --channel testing
  python tools/build.py gen-keys     Genera par de claves Ed25519
  python tools/build.py show-keys    Muestra las claves públicas actuales

Cross-compilation sin Docker:
  cargo install cargo-zigbuild
  pip install ziglang
"""

import argparse, datetime, json, os, platform, re, shutil, subprocess, sys, textwrap, time

# ─────────────────────────────────────────────
#  CONFIGURACIÓN CENTRAL — NADA MÁS QUE EDITAR
# ─────────────────────────────────────────────
# El script vive en tools/ → dos niveles arriba hasta la raíz del proyecto
PROJECT_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_NAME       = "VRC Studio"
BINARY         = "vrc-studio"       # nombre del ejecutable (sin .exe)
BUILD_DIR      = os.path.join(PROJECT_ROOT, "dist")
RELEASE_DIR    = os.environ.get(
    "VRCSTUDIO_RELEASE_DIR",
    os.path.join(PROJECT_ROOT, "releases"),
)
TAURI_DIR      = PROJECT_ROOT
KEYS_DIR       = os.path.join(PROJECT_ROOT, "tools", "keys")
UPDATE_MANIFEST_STABLE  = os.path.join(RELEASE_DIR, "update-stable.json")
UPDATE_MANIFEST_TESTING = os.path.join(RELEASE_DIR, "update-testing.json")
GITHUB_RELEASES_BASE    = "https://github.com/s7lver2/vrc-studio/releases/download"
PUBLISHER               = "Tu Nombre / Equipo"
PUBLISHER_URL           = "https://github.com/s7lver2/vrc-studio"

# Solo Windows como target principal; macOS y Linux como secundarios.
PLATFORMS = {
    "windows-amd64": {"goos": "windows", "rust_target": "x86_64-pc-windows-msvc"},
    "windows-arm64": {"goos": "windows", "rust_target": "aarch64-pc-windows-msvc"},
    "linux-amd64":   {"goos": "linux",   "rust_target": "x86_64-unknown-linux-gnu"},
    "linux-arm64":   {"goos": "linux",   "rust_target": "aarch64-unknown-linux-gnu"},
    "darwin-amd64":  {"goos": "darwin",  "rust_target": "x86_64-apple-darwin"},
    "darwin-arm64":  {"goos": "darwin",  "rust_target": "aarch64-apple-darwin"},
}

RELEASE_PLATFORMS = ["windows-amd64", "darwin-arm64", "linux-amd64"]

# ─────────────────────────────────────────────
#  TERMINAL UI (colores básicos sin dependencias)
# ─────────────────────────────────────────────
_HAS_COLOR = (os.name != "nt") or ("TERM" in os.environ)
BOLD  = "\033[1m"  if _HAS_COLOR else ""
DIM   = "\033[2m"  if _HAS_COLOR else ""
RESET = "\033[0m"  if _HAS_COLOR else ""
GREEN = "\033[32m" if _HAS_COLOR else ""
CYAN  = "\033[36m" if _HAS_COLOR else ""
YELLOW= "\033[33m" if _HAS_COLOR else ""
RED   = "\033[31m" if _HAS_COLOR else ""

def ok(msg):    print(f"{GREEN}✓{RESET} {msg}")
def info(msg):  print(f"{CYAN}▶{RESET} {msg}")
def warn(msg):  print(f"{YELLOW}⚠{RESET}  {msg}")
def error(msg): print(f"{RED}✗{RESET} {msg}", file=sys.stderr)
def step(msg):  print(f"\n{BOLD}→ {msg}{RESET}")

_BUILD_START = time.monotonic()
def elapsed():
    s = time.monotonic() - _BUILD_START
    return f"{s:.1f}s" if s < 60 else f"{int(s)//60}m {int(s)%60}s"

# ─────────────────────────────────────────────
#  UTILIDADES
# ─────────────────────────────────────────────
def run(cmd, cwd=None, env=None, check=True):
    """Ejecuta un comando mostrando la salida en tiempo real."""
    info(f"  $ {' '.join(str(x) for x in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, cmd)
    return result

def _detect_host():
    sys_map  = {"windows": "windows", "darwin": "darwin", "linux": "linux"}
    arch_map = {"x86_64": "amd64", "amd64": "amd64", "arm64": "arm64", "aarch64": "arm64"}
    os_name  = sys_map.get(platform.system().lower(), "linux")
    arch     = arch_map.get(platform.machine().lower(), "amd64")
    return f"{os_name}-{arch}"

HOST_PLATFORM = _detect_host()

def _sanitize_version(v):
    v = v.lstrip("v")
    m = re.match(r"(\d+(?:\.\d+)*)", v)
    if not m:
        return f"0.0.0"
    parts = m.group(1).split(".")
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts[:3])

def _version_to_numeric(semver):
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", semver)
    return f"{m.group(1)}.{m.group(2)}.{m.group(3)}.0" if m else "0.1.0.0"

def _read_cargo_version():
    cargo = os.path.join(PROJECT_ROOT, "src-tauri", "Cargo.toml")
    if not os.path.exists(cargo):
        return None
    for line in open(cargo, encoding="utf-8"):
        m = re.match(r'version\s*=\s*"([^"]+)"', line.strip())
        if m:
            return m.group(1)
    return None

def get_version(forced=None):
    d = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if forced:
        return _sanitize_version(forced), "manual", d
    commit = "unknown"
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass
    try:
        raw = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
        if raw and re.match(r"v?\d", raw):
            return _sanitize_version(raw), commit, d
    except Exception:
        pass
    cargo_v = _read_cargo_version()
    if cargo_v:
        warn(f"Usando version de Cargo.toml: {cargo_v}")
        return _sanitize_version(cargo_v), commit, d
    warn("No se pudo determinar version — usando 0.1.0")
    return "0.1.0", commit, d

def _patch_tauri_version(version):
    """Actualiza version en src-tauri/Cargo.toml y tauri.conf.json."""
    for path in [
        os.path.join(PROJECT_ROOT, "src-tauri", "Cargo.toml"),
        os.path.join(PROJECT_ROOT, "src-tauri", "tauri.conf.json"),
    ]:
        if not os.path.exists(path):
            continue
        content = open(path, encoding="utf-8").read()
        if path.endswith(".toml"):
            # Solo la primera aparición de version = "..." (la del [package])
            new_content = re.sub(
                r'^(version\s*=\s*")[^"]+(")',
                f'\\g<1>{version}\\g<2>',
                content, count=1, flags=re.MULTILINE
            )
        else:  # JSON
            new_content = re.sub(
                r'"version"\s*:\s*"[^"]+"',
                f'"version": "{version}"',
                content, count=1
            )
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        info(f"  {os.path.relpath(path)} → version = {version}")

def _rmtree(path):
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)
        info(f"Eliminado {path}")

def clean(deep=False):
    step("Limpiando directorios de build")
    _rmtree(BUILD_DIR)
    _rmtree(RELEASE_DIR)
    if deep:
        _rmtree(os.path.join(PROJECT_ROOT, "src-tauri", "target"))
        _rmtree(os.path.join(PROJECT_ROOT, "dist"))
        subprocess.run(["cargo", "clean"], cwd=os.path.join(PROJECT_ROOT, "src-tauri"),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.makedirs(BUILD_DIR,   exist_ok=True)
    os.makedirs(RELEASE_DIR, exist_ok=True)
    ok("Directorios limpios")

# ─────────────────────────────────────────────
#  BUILD: TAURI
# ─────────────────────────────────────────────
def _has_zigbuild():
    return shutil.which("cargo-zigbuild") is not None

def _has_zig():
    if shutil.which("zig"):
        return True
    try:
        import ziglang
        zig_exe = os.path.join(os.path.dirname(ziglang.__file__), "zig")
        if platform.system().lower() == "windows":
            zig_exe += ".exe"
        if os.path.isfile(zig_exe):
            os.environ["PATH"] = os.path.dirname(zig_exe) + os.pathsep + os.environ.get("PATH","")
            return True
    except ImportError:
        pass
    return False

def _rustup_add_target(rust_target):
    try:
        out = subprocess.check_output(
            ["rustup", "target", "list", "--installed"],
            stderr=subprocess.DEVNULL, text=True
        )
        if rust_target in out:
            return True
    except Exception:
        pass
    step(f"Instalando rustup target: {rust_target}")
    r = subprocess.run(["rustup", "target", "add", rust_target],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return r.returncode == 0

def build_tauri(platform_key, version, debug=False):
    """
    Compila la app Tauri para platform_key.

    Estrategia cross-compilation:
      - Host nativo          → cargo build (nativo)
      - Mismo OS, dist arch  → cargo-zigbuild --target
      - Cross OS             → skip con instrucciones
    """
    plat         = PLATFORMS[platform_key]
    rust_target  = plat["rust_target"]
    target_goos  = plat["goos"]
    host_goos    = PLATFORMS[HOST_PLATFORM]["goos"]
    needs_cross  = platform_key != HOST_PLATFORM
    ext          = ".exe" if target_goos == "windows" else ""

    if needs_cross and host_goos != target_goos:
        warn(f"Tauri omitido para {platform_key}: cross-OS no soportado desde {HOST_PLATFORM}")
        if target_goos == "darwin":
            warn("  macOS requiere macOS para compilar (usa GitHub Actions runner macos-latest).")
        elif target_goos == "linux":
            warn("  Linux requiere Linux o WSL en Windows.")
        elif target_goos == "windows":
            warn("  Windows requiere Windows + MSVC.")
        return None, None

    step(f"Compilando VRC Studio → {platform_key}" + (" [debug]" if debug else ""))
    _patch_tauri_version(version)

    npm = shutil.which("npm") or "npm"
    build_env = {**os.environ}

    # npm install si hace falta
    if not os.path.isdir(os.path.join(PROJECT_ROOT, "node_modules")):
        run([npm, "install"], cwd=PROJECT_ROOT)

    if needs_cross:
        # Cross-arch mismo OS: usar cargo-zigbuild si disponible
        if not _has_zigbuild():
            warn("  cargo-zigbuild no encontrado. Instala: cargo install cargo-zigbuild")
        if _has_zigbuild() and _has_zig():
            build_env["CARGO"] = shutil.which("cargo-zigbuild") or "cargo-zigbuild"
        if not _rustup_add_target(rust_target):
            warn(f"  rustup target add {rust_target} falló — saltando")
            return None, None

    build_args = [npm, "run", "tauri", "build"]
    if debug:
        build_args += ["--", "--debug"]
    if needs_cross:
        build_args += (["--", "--target", rust_target]
                       if not debug
                       else ["--target", rust_target])

    run(build_args, cwd=PROJECT_ROOT, env=build_env)

    # ── Localizar el ejecutable ───────────────────────────────────────────────
    target_dir = (
        os.path.join(PROJECT_ROOT, "src-tauri", "target", rust_target,
                     "debug" if debug else "release")
        if needs_cross else
        os.path.join(PROJECT_ROOT, "src-tauri", "target",
                     "debug" if debug else "release")
    )

    exe_src = os.path.join(target_dir, f"vrc-studio{ext}")
    if not os.path.isfile(exe_src):
        # Fallback: buscar cualquier exe que no sea instalador
        if os.path.isdir(target_dir):
            for f in os.listdir(target_dir):
                if f.endswith(ext) and ext and not any(x in f.lower() for x in ["setup","msi","bundle","installer"]):
                    exe_src = os.path.join(target_dir, f)
                    break

    if not os.path.isfile(exe_src):
        warn(f"Ejecutable no encontrado en {target_dir}")
        return None, None

    # ── Copiar a BUILD_DIR ────────────────────────────────────────────────────
    # Copia todo el directorio release (incluye WebView2Loader.dll en Windows)
    _SKIP_DIRS = {"bundle", "incremental", ".fingerprint", "deps", "build", "examples"}
    _SKIP_EXTS = {".pdb", ".d", ".rlib", ".rmeta", ".exp", ".lib"}

    dst_dir = os.path.join(BUILD_DIR, f"app-{platform_key}")
    if os.path.exists(dst_dir):
        shutil.rmtree(dst_dir)
    os.makedirs(dst_dir, exist_ok=True)

    for entry in os.listdir(target_dir):
        if entry in _SKIP_DIRS:
            continue
        _, sext = os.path.splitext(entry)
        if sext in _SKIP_EXTS:
            continue
        src_path = os.path.join(target_dir, entry)
        dst_path = os.path.join(dst_dir, entry)
        if os.path.isdir(src_path):
            shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
        else:
            shutil.copy2(src_path, dst_path)

    exe_name = os.path.basename(exe_src)
    ok(f"VRC Studio → {dst_dir}/{exe_name}  ({os.path.getsize(exe_src) // 1024} KB)")
    return dst_dir, exe_name

# ─────────────────────────────────────────────
#  INNO SETUP SCRIPT TEMPLATE
# ─────────────────────────────────────────────
INNO_SCRIPT = r'''
; ══════════════════════════════════════════════════════════════════════════════
;  VRC Studio  —  Windows Installer  v@@version@@
;  Auto-generated by build.py  |  Compile: ISCC.exe vrc-studio-setup.iss
; ══════════════════════════════════════════════════════════════════════════════

#define AppName        "VRC Studio"
#define AppVersion     "@@version@@"
#define AppPublisher   "@@publisher@@"
#define AppURL         "@@publisher_url@@"
#define AppExeName     "vrc-studio.exe"
#define AppDescription "Unity Development for VRChat"

; ── Branding images (generated by build.py, placed in tools/) ─────────────
#define WizardImage      "@@tools_dir@@\installer-sidebar.bmp"
#define WizardSmallImage "@@tools_dir@@\installer-small.bmp"

[Setup]
; ── Identity ──────────────────────────────────────────────────────────────
AppId={{D4F7B8C1-3A2E-4F9A-8C6D-1E5B7A3F2D8C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
AppComments={#AppDescription}

; ── Paths ─────────────────────────────────────────────────────────────────
DefaultDirName={autopf}\VRC Studio
DefaultGroupName=VRC Studio
AllowNoIcons=yes

; ── Architecture ──────────────────────────────────────────────────────────
ArchitecturesAllowed=x64compatible arm64
ArchitecturesInstallIn64BitMode=x64compatible arm64

; ── Privileges — install for current user by default, allow elevation ─────
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; ── Output ────────────────────────────────────────────────────────────────
OutputDir=@@release_dir@@
OutputBaseFilename=VRC-Studio-Setup-@@version@@-@@platform_key@@
SetupIconFile=@@icon_file@@

; ── Compression ───────────────────────────────────────────────────────────
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

; ── Wizard appearance ─────────────────────────────────────────────────────
WizardStyle=modern
WizardImageFile={#WizardImage}
WizardSmallImageFile={#WizardSmallImage}
WizardImageStretch=no
WizardSizePercent=100

; ── Language: English always, no dialog ───────────────────────────────────
ShowLanguageDialog=no

; ── Uninstall ─────────────────────────────────────────────────────────────
UninstallDisplayName=VRC Studio {#AppVersion}
UninstallDisplayIcon={app}\vrc-studio.exe
CreateUninstallRegKey=yes

; ── Version metadata (visible in explorer properties) ─────────────────────
VersionInfoVersion=@@numeric_version@@
VersionInfoCompany=@@publisher@@
VersionInfoProductName=VRC Studio
VersionInfoDescription=VRC Studio Installer
VersionInfoTextVersion=@@version@@
VersionInfoCopyright=Copyright (C) 2024 @@publisher@@

; ── Misc ──────────────────────────────────────────────────────────────────
ChangesEnvironment=no
DisableProgramGroupPage=no
DisableWelcomePage=no
DisableReadyPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── Optional tasks the user sees on the "Select Additional Tasks" page ─────
[Tasks]
Name: "desktopicon";  Description: "Create a &desktop shortcut";              GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "startmenu";    Description: "Create a &Start Menu entry";              GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "autostart";    Description: "Launch VRC Studio when &Windows starts";  GroupDescription: "Startup:";   Flags: unchecked
Name: "assoc_vrcsp";  Description: "Associate &.vrcsp project files with VRC Studio"; GroupDescription: "File associations:"; Flags: unchecked

[Dirs]
Name: "{app}"
Name: "{app}\data"
Name: "{localappdata}\VRC Studio"
Name: "{localappdata}\VRC Studio\config"
Name: "{localappdata}\VRC Studio\logs"

[Files]
; ── Main application bundle ───────────────────────────────────────────────
Source: "@@app_bundle@@\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── App icon (for shortcuts & uninstaller) ────────────────────────────────
Source: "@@icon_file@@"; DestDir: "{app}"; DestName: "vrc-studio.ico"; Flags: ignoreversion

[Icons]
; Start Menu
Name: "{group}\VRC Studio";            Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\vrc-studio.ico"; Tasks: startmenu
Name: "{group}\Uninstall VRC Studio";  Filename: "{uninstallexe}";                                           Tasks: startmenu

; Desktop
Name: "{userdesktop}\VRC Studio";      Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\vrc-studio.ico"; Tasks: desktopicon

[Registry]
; ── App metadata ──────────────────────────────────────────────────────────
Root: HKCU; Subkey: "Software\VRC Studio"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}";        Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\VRC Studio"; ValueType: string; ValueName: "Version";    ValueData: "@@version@@";  Flags: uninsdeletekey

; ── Windows startup (autostart task) ─────────────────────────────────────
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "VRCStudio"; ValueData: """{app}\{#AppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

; ── .vrcsp file association (optional task) ───────────────────────────────
Root: HKCR; Subkey: ".vrcsp";                        ValueType: string; ValueName: "";          ValueData: "VRCStudio.Project"; Flags: uninsdeletekey;   Tasks: assoc_vrcsp
Root: HKCR; Subkey: "VRCStudio.Project";             ValueType: string; ValueName: "";          ValueData: "VRC Studio Project"; Flags: uninsdeletekey;  Tasks: assoc_vrcsp
Root: HKCR; Subkey: "VRCStudio.Project\DefaultIcon"; ValueType: string; ValueName: "";          ValueData: "{app}\vrc-studio.ico,0"; Flags: uninsdeletekey; Tasks: assoc_vrcsp
Root: HKCR; Subkey: "VRCStudio.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""; Flags: uninsdeletekey; Tasks: assoc_vrcsp

[Run]
; Launch after install (user can uncheck)
Filename: "{app}\{#AppExeName}"; Description: "Launch VRC Studio now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Nothing to run on uninstall — data is left in %LOCALAPPDATA%\VRC Studio

[Code]
{ ═══════════════════════════════════════════════════════════════════════════
  Custom installer pages & logic
  ═══════════════════════════════════════════════════════════════════════════ }

{ ── Welcome page: show version in subtitle ─────────────────────────────── }
procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This will install VRC Studio ' + '{#AppVersion}' + ' on your computer.' + #13#10 + #13#10 +
    'VRC Studio is an avatar asset manager and project launcher for Unity / VRChat creators.' + #13#10 + #13#10 +
    'It is recommended to close all other applications before continuing.';
end;

{ ── Check for existing installation and offer upgrade path ─────────────── }
function InitializeSetup: Boolean;
var
  OldVersion: String;
  Msg: String;
begin
  Result := True;
  if RegQueryStringValue(HKCU, 'Software\VRC Studio', 'Version', OldVersion) then begin
    if OldVersion <> '{#AppVersion}' then begin
      Msg := 'VRC Studio ' + OldVersion + ' is already installed.' + #13#10 + #13#10 +
             'This installer will upgrade it to version {#AppVersion}.' + #13#10 + #13#10 +
             'Your settings and projects will not be affected. Continue?';
      Result := MsgBox(Msg, mbConfirmation, MB_YESNO) = IDYES;
    end;
  end;
end;

{ ── Prevent install on Windows 7 / 8 (Tauri 2 requires Win10+) ─────────── }
function CheckWindowsVersion: Boolean;
begin
  Result := (GetWindowsVersion >= $0A000000); { Windows 10 = 10.0 }
  if not Result then
    MsgBox('VRC Studio requires Windows 10 or later.', mbError, MB_OK);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not CheckWindowsVersion then
    Result := 'Windows 10 or later is required to install VRC Studio.';
end;

{ ── After install: write a first-run marker ─────────────────────────────── }
procedure CurStepChanged(CurStep: TSetupStep);
var
  FirstRunFile: String;
begin
  if CurStep = ssDone then begin
    FirstRunFile := ExpandConstant('{localappdata}\VRC Studio\config\first-run');
    if not FileExists(FirstRunFile) then
      SaveStringToFile(FirstRunFile, '{#AppVersion}', False);
  end;
end;
'''

# ─────────────────────────────────────────────
#  CREAR INSTALADOR WINDOWS
# ─────────────────────────────────────────────
def create_windows_installer(app_bundle_dir, version, platform_key="windows-amd64"):
    step("Creando instalador GUI Windows (Inno Setup)")

    icon_file = os.path.join(PROJECT_ROOT, "src-tauri", "icons", "icon.ico")
    if not os.path.exists(icon_file):
        warn(f"Icono no encontrado en {icon_file}")
        icon_file = ""

    def _w(p):
        return p.replace("/", "\\") if p else ""

    tools_dir = os.path.join(PROJECT_ROOT, "tools")
    subs = {
        "@@version@@":        version,
        "@@numeric_version@@": _version_to_numeric(version),
        "@@publisher@@":      PUBLISHER,
        "@@publisher_url@@":  PUBLISHER_URL,
        "@@app_bundle@@":     _w(app_bundle_dir),
        "@@icon_file@@":      _w(icon_file),
        "@@release_dir@@":    _w(RELEASE_DIR),
        "@@platform_key@@":   platform_key,
        "@@tools_dir@@":      _w(tools_dir),
    }
    iss_content = INNO_SCRIPT
    for k, v in subs.items():
        iss_content = iss_content.replace(k, v)

    iss_path = os.path.join(PROJECT_ROOT, "tools", "vrc-studio-setup.iss")
    os.makedirs(os.path.dirname(iss_path), exist_ok=True)
    with open(iss_path, "w", encoding="utf-8") as f:
        f.write(iss_content)
    info(f"Script Inno Setup → {os.path.relpath(iss_path)}")

    # Buscar ISCC
    iscc_candidates = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
        r"C:\Users\NICKE\AppData\Local\Programs\Inno Setup 6\ISCC.exe",
    ]
    iscc = shutil.which("ISCC") or shutil.which("iscc")
    if not iscc:
        iscc = next((p for p in iscc_candidates if os.path.isfile(p)), None)

    if not iscc:
        warn("ISCC (Inno Setup) no encontrado.")
        warn(f"Ejecuta manualmente: ISCC.exe \"{iss_path}\"")
        return iss_path

    info(f"ISCC → {iscc}")
    run([iscc, iss_path])
    ok(f"Instalador → VRC-Studio-Setup-{version}-{platform_key}.exe")
    return iss_path

# ─────────────────────────────────────────────
#  CREAR INSTALADOR LINUX / MACOS  (.tar.gz)
# ─────────────────────────────────────────────
INSTALL_SH = r'''#!/usr/bin/env bash
# VRC Studio Installer v@@version@@ (@@platform_key@@)
set -euo pipefail

APP="VRC Studio"
VERSION="@@version@@"
BINARY="vrc-studio"
PREFIX="${PREFIX:-$HOME/.local}"
BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share/vrc-studio"
YES=false

for arg in "$@"; do
  case "$arg" in
    --prefix=*) PREFIX="${arg#--prefix=}"; BINDIR="$PREFIX/bin"; DATADIR="$PREFIX/share/vrc-studio" ;;
    -y|--yes)   YES=true ;;
    -h|--help)  echo "Uso: ./install.sh [--prefix=DIR] [-y]"; exit 0 ;;
  esac
done

if [ "$YES" = false ]; then
  echo "Instalar VRC Studio $VERSION en $PREFIX ? [S/n]"
  read -r ans
  case "${ans:-S}" in [nN]*) echo "Cancelado."; exit 0 ;; esac
fi

mkdir -p "$BINDIR" "$DATADIR"
cp "vrc-studio" "$BINDIR/$BINARY" 2>/dev/null || true
chmod +x "$BINDIR/$BINARY" 2>/dev/null || true

# Añadir al PATH si no está
for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$prof" ] && grep -q "$BINDIR" "$prof" 2>/dev/null && continue
  [ -f "$prof" ] && echo "export PATH=\"$BINDIR:\$PATH\"  # VRC Studio" >> "$prof"
done

echo "✓ VRC Studio $VERSION instalado en $BINDIR/$BINARY"
echo "  Reinicia la terminal o ejecuta: source ~/.bashrc"
'''

UNINSTALL_SH = r'''#!/usr/bin/env bash
set -euo pipefail
PREFIX="${1:-$HOME/.local}"
BINDIR="$PREFIX/bin"
rm -f "$BINDIR/vrc-studio"
for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$prof" ] && sed -i "/VRC Studio/d" "$prof" 2>/dev/null || true
done
echo "✓ VRC Studio desinstalado."
'''

def create_unix_installer(platform_key, app_bundle_dir, version):
    step(f"Creando instalador .tar.gz → {platform_key}")
    plat_dir = os.path.join(RELEASE_DIR, f"vrc-studio-{version}-{platform_key}")
    os.makedirs(plat_dir, exist_ok=True)

    # Copiar bundle
    if app_bundle_dir and os.path.exists(app_bundle_dir):
        for f in os.listdir(app_bundle_dir):
            src = os.path.join(app_bundle_dir, f)
            dst = os.path.join(plat_dir, f)
            if os.path.isfile(src):
                shutil.copy2(src, dst)

    for name, content in [("install.sh", INSTALL_SH), ("uninstall.sh", UNINSTALL_SH)]:
        path = os.path.join(plat_dir, name)
        content = content.replace("@@version@@", version).replace("@@platform_key@@", platform_key)
        with open(path, "w", newline="\n", encoding="utf-8") as f:
            f.write(content)
        os.chmod(path, 0o755)

    tar_name = f"vrc-studio-{version}-{platform_key}.tar.gz"
    tar_path = os.path.join(RELEASE_DIR, tar_name)
    run(["tar", "-czf", tar_path, "-C", RELEASE_DIR, os.path.basename(plat_dir)])
    shutil.rmtree(plat_dir)
    ok(f"Instalador → {tar_name}")
    return tar_path

# ─────────────────────────────────────────────
#  KEY MANAGEMENT (Ed25519)
# ─────────────────────────────────────────────
def _require_crypto():
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        return True
    except ImportError:
        error("Instala: pip install cryptography")
        return False

def _key_paths(channel):
    os.makedirs(KEYS_DIR, exist_ok=True)
    return (
        os.path.join(KEYS_DIR, f"{channel}_private.pem"),
        os.path.join(KEYS_DIR, f"{channel}_public.b64"),
    )

def cmd_gen_keys():
    step("Generando claves Ed25519")
    if not _require_crypto():
        sys.exit(1)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption
    )
    import base64

    for channel in ("stable", "testing"):
        priv_path, pub_path = _key_paths(channel)
        if os.path.exists(priv_path):
            warn(f"  {channel}: clave ya existe — bórrala manualmente para regenerar.")
            if os.path.exists(pub_path):
                info(f"  {channel} public key: {open(pub_path).read().strip()}")
            continue
        priv = Ed25519PrivateKey.generate()
        pub  = priv.public_key()
        priv_pem = priv.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        pub_b64  = base64.b64encode(pub.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()
        with open(priv_path, "wb") as f:
            f.write(priv_pem)
        os.chmod(priv_path, 0o600)
        with open(pub_path, "w") as f:
            f.write(pub_b64)
        ok(f"  {channel} private → {priv_path}")
        ok(f"  {channel} public  → {pub_path}")
        print(f"\n  {BOLD}Copia esta clave pública ({channel}) a updates.rs:{RESET}")
        print(f"  {pub_b64}\n")

    print(f"  {YELLOW}IMPORTANTE:{RESET}")
    print("  1. Añade tools/keys/ a .gitignore — nunca subas claves privadas.")
    print("  2. Pega las claves públicas en STABLE_PUBKEY_B64 / TESTING_PUBKEY_B64")
    print("     en src-tauri/src/commands/updates.rs antes de compilar.")

def cmd_show_keys():
    for channel in ("stable", "testing"):
        _, pub_path = _key_paths(channel)
        if os.path.exists(pub_path):
            print(f"  {BOLD}{channel}{RESET}: {open(pub_path).read().strip()}")
        else:
            warn(f"  {channel}: no hay clave. Ejecuta: python build.py gen-keys")

def _sign_file(file_path, channel):
    if not _require_crypto():
        return ""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    import base64
    priv_path, _ = _key_paths(channel)
    if not os.path.exists(priv_path):
        warn(f"  Clave privada '{channel}' no encontrada — firma omitida.")
        return ""
    priv = load_pem_private_key(open(priv_path, "rb").read(), password=None)
    data = open(file_path, "rb").read()
    return base64.b64encode(priv.sign(data)).decode()

# ─────────────────────────────────────────────
#  UPDATE MANIFEST
# ─────────────────────────────────────────────
def generate_update_manifests(version, date, channel="stable", notes=""):
    step(f"Generando manifiesto de actualización → {channel}")
    platforms = {}
    if os.path.isdir(RELEASE_DIR):
        for fname in sorted(os.listdir(RELEASE_DIR)):
            fpath = os.path.join(RELEASE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if fname.startswith("update-") and fname.endswith(".json"):
                continue
            pk = next((c for c in PLATFORMS if c in fname), None)
            if not pk:
                continue
            tag  = f"v{version}" if channel == "stable" else f"v{version}-testing"
            url  = f"{GITHUB_RELEASES_BASE}/{tag}/{fname}"
            sig  = _sign_file(fpath, channel)
            size = os.path.getsize(fpath)
            platforms[pk] = {"url": url, "signature": sig, "size": size}
            signed = "✓ firmado" if sig else "⚠ sin firma"
            info(f"  {pk:20s}  {size//1024//1024:.1f} MB  {signed}")

    manifest = {
        "version":  version,
        "channel":  channel,
        "pub_date": date,
        "notes":    notes or f"VRC Studio {version} ({channel})",
        "platforms": platforms,
    }
    path = UPDATE_MANIFEST_STABLE if channel == "stable" else UPDATE_MANIFEST_TESTING
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    ok(f"Manifiesto → {os.path.basename(path)}")
    return path

# ─────────────────────────────────────────────
#  GITHUB RELEASE
# ─────────────────────────────────────────────
def _has_gh():
    return shutil.which("gh") is not None

def publish_github_release(version, channel, notes, manifest_path):
    step(f"Publicando GitHub Release → {channel} v{version}")
    if not _has_gh():
        warn("`gh` CLI no instalada. Instala: https://cli.github.com/")
        return
    tag    = f"v{version}" if channel == "stable" else f"v{version}-testing"
    is_pre = channel == "testing"
    body   = notes or f"VRC Studio {version}"

    upload_files = [
        os.path.join(RELEASE_DIR, f)
        for f in sorted(os.listdir(RELEASE_DIR))
        if os.path.isfile(os.path.join(RELEASE_DIR, f))
        and not (f.startswith("update-") and f.endswith(".json"))
    ]
    if manifest_path and os.path.exists(manifest_path):
        manifest_copy = os.path.join(RELEASE_DIR, "manifest.json")
        shutil.copy(manifest_path, manifest_copy)
        upload_files.append(manifest_copy)

    subprocess.run(["git", "tag", "-f", tag], cwd=PROJECT_ROOT,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "push", "origin", tag, "--force"],
                   cwd=PROJECT_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    cmd = ["gh", "release", "create", tag, "--title", f"VRC Studio {version}",
           "--notes", body, "--verify-tag"]
    cmd += ["--prerelease", "--latest=false"] if is_pre else ["--latest"]
    cmd += upload_files
    try:
        run(cmd, cwd=PROJECT_ROOT)
        ok(f"GitHub Release → {tag}")
    except subprocess.CalledProcessError as e:
        warn(f"gh release create falló (exit={e.returncode}). Publícalo manualmente.")

# ─────────────────────────────────────────────
#  COMANDOS PRINCIPALES
# ─────────────────────────────────────────────
def cmd_dev(forced_version=None, quick=False):
    step("→ dev" + (" [--quick]" if quick else ""))
    info(f"Host: {HOST_PLATFORM}")

    npm = shutil.which("npm") or "npm"

    if quick:
        # build --debug rápido + copia directa
        version, _, _ = get_version(forced_version)
        _patch_tauri_version(version)

        # Limpiar .next-equivalent (dist/) para forzar rebuild
        for d in [os.path.join(PROJECT_ROOT, "dist")]:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
                info(f"  {d} eliminado")

        run([npm, "run", "tauri", "build", "--", "--debug",
             "--target", PLATFORMS[HOST_PLATFORM]["rust_target"]],
            cwd=PROJECT_ROOT)
        ok("Build dev completado.")
        return

    # Modo dev: lanza tauri dev con HMR completo
    step("→ Iniciando VRC Studio en modo desarrollo (HMR)")
    npm = shutil.which("npm") or "npm"

    # npm install si hace falta
    if not os.path.isdir(os.path.join(PROJECT_ROOT, "node_modules")):
        info("  Instalando dependencias npm…")
        run([npm, "install"], cwd=PROJECT_ROOT)

    info("  Lanzando: npm run tauri dev")
    info("  (Ctrl+C para salir · los cambios en src/ se recargan en tiempo real)")
    print()

    # Lanzar tauri dev — esto bloquea hasta que el usuario hace Ctrl+C
    try:
        subprocess.run(
            [npm, "run", "tauri", "dev"],
            cwd=PROJECT_ROOT
        )
    except KeyboardInterrupt:
        print()
        ok("Modo desarrollo cerrado.")
    return

    if not app_bundle:
        error("Build falló.")
        sys.exit(1)

    if "windows" in HOST_PLATFORM:
        create_windows_installer(app_bundle, version, HOST_PLATFORM)
        # Lanzar el wizard
        candidates = [
            f for f in os.listdir(RELEASE_DIR)
            if f.endswith(".exe") and "setup" in f.lower()
        ]
        if candidates:
            installer = os.path.join(RELEASE_DIR, sorted(candidates)[-1])
            info(f"Lanzando instalador → {os.path.basename(installer)}")
            subprocess.run([installer])
    else:
        create_unix_installer(HOST_PLATFORM, app_bundle, version)

    print(f"\n{BOLD}Build completado en {elapsed()}{RESET}")

def cmd_dev(forced_version=None, quick=False):
    step("→ dev" + (" [--quick]" if quick else ""))
    info(f"Host: {HOST_PLATFORM}")

    npm = shutil.which("npm") or "npm"

    if quick:
        # build --debug rápido + copia directa (comportamiento anterior)
        version, _, _ = get_version(forced_version)
        _patch_tauri_version(version)

        for d in [os.path.join(PROJECT_ROOT, "dist")]:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
                info(f"  {d} eliminado")

        run([npm, "run", "tauri", "build", "--", "--debug",
             "--target", PLATFORMS[HOST_PLATFORM]["rust_target"]],
            cwd=PROJECT_ROOT)
        ok("Build dev completado.")
        return

    # Modo dev: lanza tauri dev con HMR completo
    step("→ Iniciando VRC Studio en modo desarrollo (HMR)")

    if not os.path.isdir(os.path.join(PROJECT_ROOT, "node_modules")):
        info("  Instalando dependencias npm…")
        run([npm, "install"], cwd=PROJECT_ROOT)

    info("  Lanzando: npm run tauri dev")
    info("  (Ctrl+C para salir · los cambios en src/ se recargan en tiempo real)")
    print()

    try:
        subprocess.run(
            [npm, "run", "tauri", "dev"],
            cwd=PROJECT_ROOT
        )
    except KeyboardInterrupt:
        print()
        ok("Modo desarrollo cerrado.")

def cmd_release(forced_version=None, channel="stable", notes="", no_publish=False):
    step(f"→ release [{channel}]")
    warn("Compilará para todas las plataformas configuradas en RELEASE_PLATFORMS.")
    if input("  ¿Continuar? [s/N] ").strip().lower() not in ("s", "si", "y", "yes"):
        sys.exit(0)

    clean(deep=False)
    version, commit, date = get_version(forced_version)
    info(f"Version: {BOLD}{version}{RESET}  Canal: {BOLD}{channel}{RESET}")
    print()

    for pk in RELEASE_PLATFORMS:
        step(f"Platform: {pk}")
        app_bundle, exe_name = build_tauri(pk, version)
        if not app_bundle:
            warn(f"  Skipped: {pk}")
            continue
        if "windows" in pk:
            create_windows_installer(app_bundle, version, pk)
        else:
            create_unix_installer(pk, app_bundle, version)

    manifest_path = generate_update_manifests(version, date, channel=channel, notes=notes)

    if not no_publish:
        publish_github_release(version, channel, notes, manifest_path)
    else:
        warn("--no-publish: artefactos generados localmente en releases/")

    print(f"\n{BOLD}Release {version} ({channel}) completada en {elapsed()}{RESET}")


# ─────────────────────────────────────────────
#  TOOLS REGISTRY GENERATOR
# ─────────────────────────────────────────────
#
#  Estructura de cada tool en tools/<tool-id>/tool.json:
#
#  {
#    "id":               "avatar-performance-analyzer",
#    "name":             "Avatar Performance Analyzer",
#    "version":          "1.0.0",          ← se sobreescribe con Cargo.toml si existe
#    "description":      "...",
#    "author":           "s7lver",
#    "icon_url":         "https://raw.githubusercontent.com/.../icon.png",
#    "banner_url":       "https://raw.githubusercontent.com/.../banner.png",
#    "screenshots":      [],
#    "category":         "performance",    ← performance | workflow | visuals | util
#    "requires_unity":   true,
#    "min_unity_version": "2022.3",
#    "featured":         false,
#    "downloads": {
#      "sidecar_windows": "",              ← se rellena automáticamente si hay release
#      "sidecar_macos":   "",
#      "sidecar_linux":   "",
#      "ui_bundle":       ""
#    }
#  }
#
#  Uso:
#    python tools/build.py registry              Genera registry.json localmente
#    python tools/build.py registry --push       Genera + sube al repo GitHub
#    python tools/build.py registry --release v1.0.0  Inyecta URLs de release

TOOLS_REGISTRY_VERSION = 1
TOOLS_DIR = os.path.join(PROJECT_ROOT, "tools")

# Repo donde vive el registry (formato "owner/repo")
REGISTRY_REPO   = "s7lver2/vrc-studio"
# Rama por defecto donde se sube el registry.json (puede sobreescribirse con --branch)
REGISTRY_BRANCH = "main"
# Subcarpeta dentro del repo donde vive el registry (evita colisión con código)
REGISTRY_SUBDIR = "tools-registry"
# URL base de raw.githubusercontent.com para assets
REGISTRY_RAW_BASE = f"https://raw.githubusercontent.com/{REGISTRY_REPO}/{REGISTRY_BRANCH}/{REGISTRY_SUBDIR}"
# URL que apunta al registry.json generado (pegar en REGISTRY_URL de tools.rs)
REGISTRY_JSON_URL = f"{REGISTRY_RAW_BASE}/registry.json"

# GitHub releases base del mismo repo
TOOLS_RELEASES_BASE = f"https://github.com/{REGISTRY_REPO}/releases/download"


def _read_cargo_tool_version(tool_dir):
    """Lee la versión del Cargo.toml del sidecar si existe."""
    cargo_path = os.path.join(tool_dir, "Cargo.toml")
    if not os.path.exists(cargo_path):
        return None
    try:
        for line in open(cargo_path, encoding="utf-8"):
            m = re.match(r'version\s*=\s*"([^"]+)"', line.strip())
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


def _discover_tools():
    """
    Escanea tools/<name>/ buscando directorios con tool.json.
    Devuelve lista de (tool_dir, tool_meta_dict).
    """
    found = []
    if not os.path.isdir(TOOLS_DIR):
        return found

    for entry in sorted(os.listdir(TOOLS_DIR)):
        tool_dir = os.path.join(TOOLS_DIR, entry)
        if not os.path.isdir(tool_dir):
            continue
        meta_path = os.path.join(tool_dir, "tool.json")
        if not os.path.exists(meta_path):
            # Sin tool.json → ignorar
            continue
        try:
            meta = json.load(open(meta_path, encoding="utf-8"))
        except Exception as e:
            warn(f"  tool.json inválido en {entry}: {e}")
            continue
        found.append((tool_dir, meta))
    return found


def _build_registry_entry(tool_dir, meta, release_tag=None):
    """
    Construye un ToolRegistryEntry a partir de tool.json.
    Si release_tag se provee, inyecta las URLs de descarga de ese release.
    """
    tool_id = meta.get("id", os.path.basename(tool_dir))

    # La versión puede venir del Cargo.toml del sidecar (fuente de verdad)
    cargo_version = _read_cargo_tool_version(tool_dir)
    version = cargo_version or meta.get("version", "0.1.0")

    tag = release_tag or f"v{version}"

    # URLs de release del sidecar — se rellenan solo si el release existe
    def sidecar_url(suffix):
        if release_tag:
            return f"{TOOLS_RELEASES_BASE}/{tag}/{tool_id}-{suffix}"
        return meta.get("downloads", {}).get(
            f"sidecar_{suffix.split('-')[0]}", ""
        )

    downloads = {
        "ui_bundle":       meta.get("downloads", {}).get("ui_bundle", ""),
        "sidecar_windows": sidecar_url("windows-x64.exe"),
        "sidecar_macos":   sidecar_url("macos-arm64"),
        "sidecar_linux":   sidecar_url("linux-x64"),
    }

    entry = {
        "id":                tool_id,
        "name":              meta.get("name", tool_id),
        "version":           version,
        "description":       meta.get("description", ""),
        "author":            meta.get("author", ""),
        "icon_url":          meta.get("icon_url", ""),
        "banner_url":        meta.get("banner_url", ""),
        "screenshots":       meta.get("screenshots", []),
        "category":          meta.get("category", "util"),
        "downloads":         downloads,
        "dependencies":      meta.get("dependencies", []),
        "requires_unity":    meta.get("requires_unity", False),
        "min_unity_version": meta.get("min_unity_version", ""),
        "featured":          meta.get("featured", False),
    }
    return entry


def _generate_registry_json(release_tag=None):
    """Genera el objeto registry.json completo y lo devuelve como dict."""
    tools_found = _discover_tools()
    if not tools_found:
        warn("  No se encontraron tool.json en tools/*/. Crea uno primero.")
        warn("  Ejemplo: tools/avatar-perf-core/tool.json")
        return None

    entries = []
    for tool_dir, meta in tools_found:
        entry = _build_registry_entry(tool_dir, meta, release_tag)
        entries.append(entry)
        ok(f"  ✓ {entry['id']} v{entry['version']}")

    registry = {
        "version": TOOLS_REGISTRY_VERSION,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "tools": entries,
    }
    return registry


def _write_registry(registry, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
    ok(f"  registry.json → {out_path}")


def _push_registry_to_github(registry_path, branch=None):
    """
    Hace push de registry.json al repo REGISTRY_REPO usando 'gh' CLI.
    Estrategia: crea/actualiza el archivo directamente vía gh api
    (no necesita clonar el repo de tools).
    """
    target_branch = branch or REGISTRY_BRANCH
    if not shutil.which("gh"):
        warn("  gh CLI no encontrada. Instala: https://cli.github.com/")
        warn(f"  Sube manualmente {registry_path} a {REGISTRY_REPO}:{target_branch}/{REGISTRY_SUBDIR}/registry.json")
        return False

    content_bytes = open(registry_path, "rb").read()
    import base64
    content_b64 = base64.b64encode(content_bytes).decode()

    # Obtener el SHA actual del archivo (necesario para actualizar, no para crear)
    sha = ""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{REGISTRY_REPO}/contents/{REGISTRY_SUBDIR}/registry.json",
             "--jq", ".sha",
             "-H", f"X-GitHub-Ref: {target_branch}"],
            capture_output=True, text=True
        )
        if not result.stdout.strip():
            # Try with ?ref= query parameter via env var or direct flag
            result2 = subprocess.run(
                ["gh", "api", f"repos/{REGISTRY_REPO}/contents/{REGISTRY_SUBDIR}/registry.json?ref={target_branch}",
                 "--jq", ".sha"],
                capture_output=True, text=True
            )
            sha = result2.stdout.strip().strip('"')
        else:
            sha = result.stdout.strip().strip('"')
    except Exception:
        pass

    # Construir el payload para la API
    payload = {
        "message": f"chore: update tools registry [{target_branch}]",
        "content": content_b64,
        "branch":  target_branch,
    }
    if sha:
        payload["sha"] = sha

    payload_json = json.dumps(payload)
    tmp_payload = os.path.join(PROJECT_ROOT, ".registry_payload_tmp.json")
    with open(tmp_payload, "w", encoding="utf-8") as f:
        f.write(payload_json)

    result = subprocess.run(
        ["gh", "api", "--method", "PUT",
         f"repos/{REGISTRY_REPO}/contents/{REGISTRY_SUBDIR}/registry.json",
         "--input", tmp_payload],
        capture_output=True, text=True, cwd=PROJECT_ROOT
    )
    os.remove(tmp_payload)

    raw_base = f"https://raw.githubusercontent.com/{REGISTRY_REPO}/{target_branch}/{REGISTRY_SUBDIR}"
    registry_json_url = f"{raw_base}/registry.json"

    if result.returncode == 0:
        ok(f"  registry.json subido a {REGISTRY_REPO}:{target_branch}/{REGISTRY_SUBDIR}/registry.json")
        ok(f"  URL: {registry_json_url}")
        return True
    else:
        error(f"  gh api falló: {result.stderr.strip()}")
        warn(f"  Sube manualmente {registry_path} a {REGISTRY_REPO}:{target_branch}/registry.json")
        return False


def _create_tool_json_template(tool_id):
    """Crea un tool.json de ejemplo en tools/<tool_id>/tool.json."""
    tool_dir = os.path.join(TOOLS_DIR, tool_id)
    os.makedirs(tool_dir, exist_ok=True)
    meta_path = os.path.join(tool_dir, "tool.json")
    if os.path.exists(meta_path):
        warn(f"  {meta_path} ya existe. No sobreescribiendo.")
        return

    template = {
        "id":                tool_id,
        "name":              tool_id.replace("-", " ").title(),
        "version":           "1.0.0",
        "description":       "Descripción de la tool.",
        "author":            "s7lver",
        "icon_url":          f"{REGISTRY_RAW_BASE}/assets/{tool_id}/icon.png",
        "banner_url":        f"{REGISTRY_RAW_BASE}/assets/{tool_id}/banner.png",
        "screenshots":       [],
        "category":          "util",
        "requires_unity":    False,
        "min_unity_version": "",
        "featured":          False,
        "downloads":         {
            "ui_bundle":       "",
            "sidecar_windows": "",
            "sidecar_macos":   "",
            "sidecar_linux":   "",
        },
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(template, f, indent=2, ensure_ascii=False)
    ok(f"  Creado template → {meta_path}")
    info(f"  Edítalo y luego ejecuta: python tools/build.py registry --push")


def cmd_registry(push=False, release_tag=None, init_tool=None, branch=None):
    """
    Genera registry.json a partir de tools/*/tool.json.
    --push          Sube el JSON al repo GitHub via gh API
    --release v1.x  Inyecta URLs de release en los downloads
    --init <id>     Crea un tool.json de ejemplo para una nueva tool
    --branch <name> Rama donde subir el registry (por defecto: main)
                    Ejemplo: --branch feature/tools-system
    """
    step("→ registry")

    if init_tool:
        info(f"Inicializando tool.json para: {init_tool}")
        _create_tool_json_template(init_tool)
        return

    target_branch = branch or REGISTRY_BRANCH

    # Actualizar constantes derivadas de la rama elegida
    raw_base = f"https://raw.githubusercontent.com/{REGISTRY_REPO}/{target_branch}/{REGISTRY_SUBDIR}"
    registry_json_url = f"{raw_base}/registry.json"

    info("Escaneando tools/*/tool.json…")
    registry = _generate_registry_json(release_tag=release_tag)
    if registry is None:
        sys.exit(1)

    # Guardar localmente en tools/
    registry_path = os.path.join(TOOLS_DIR, "registry.json")
    _write_registry(registry, registry_path)

    # Resumen
    n = len(registry["tools"])
    print()
    info(f"  {n} tool{'s' if n != 1 else ''} en el registry")
    info(f"  Rama de destino: {BOLD}{target_branch}{RESET}")
    info(f"  Pon esta URL en REGISTRY_REPO de src-tauri/src/commands/tools.rs")
    info(f"  (la rama se lee dinámicamente desde app-settings.json)")
    print(f"  {BOLD}{registry_json_url}{RESET}")
    print()

    if push:
        step(f"Subiendo registry.json a GitHub (rama: {target_branch})…")
        _push_registry_to_github(registry_path, branch=target_branch)
    else:
        info(f"  Para subir a main:                  python tools/build.py registry --push")
        info(f"  Para subir a feature/tools-system:  python tools/build.py registry --push --branch feature/tools-system")


# ─────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────
def parse_args():
    raw = sys.argv[1:]
    forced_version = None
    deep_clean     = False
    quick          = False
    channel        = "stable"
    notes          = ""
    no_publish     = False
    push           = False
    release_tag    = None
    init_tool      = None
    registry_branch = None
    filtered       = []
    i = 0
    while i < len(raw):
        if raw[i] == "--version" and i + 1 < len(raw):
            forced_version = raw[i + 1]; i += 2
        elif raw[i] == "--deep":
            deep_clean = True; i += 1
        elif raw[i] == "--quick":
            quick = True; i += 1
        elif raw[i] == "--channel" and i + 1 < len(raw):
            channel = raw[i + 1]; i += 2
        elif raw[i] == "--notes" and i + 1 < len(raw):
            notes = raw[i + 1]; i += 2
        elif raw[i] == "--no-publish":
            no_publish = True; i += 1
        elif raw[i] == "--push":
            push = True; i += 1
        elif raw[i] == "--release" and i + 1 < len(raw):
            release_tag = raw[i + 1]; i += 2
        elif raw[i] == "--init" and i + 1 < len(raw):
            init_tool = raw[i + 1]; i += 2
        elif raw[i] == "--branch" and i + 1 < len(raw):
            registry_branch = raw[i + 1]; i += 2
        elif raw[i].startswith("--"):
            error(f"Flag desconocido: {raw[i]}")
            sys.exit(1)
        else:
            filtered.append(raw[i]); i += 1
    command = filtered[0].lower() if filtered else "dev"
    return command, forced_version, deep_clean, quick, channel, notes, no_publish, push, release_tag, init_tool, registry_branch

def main():
    command, forced_version, deep_clean, quick, channel, notes, no_publish, push, release_tag, init_tool, registry_branch = parse_args()
    if command == "clean":
        warn("Esto eliminará dist/ y releases/." + (" Y target/." if deep_clean else ""))
        if input("  ¿Continuar? [s/N] ").strip().lower() in ("s","si","y","yes"):
            clean(deep=deep_clean)
    elif command == "release":
        cmd_release(forced_version, channel=channel, notes=notes, no_publish=no_publish)
    elif command == "registry":
        cmd_registry(push=push, release_tag=release_tag, init_tool=init_tool, branch=registry_branch)
    elif command == "gen-keys":
        cmd_gen_keys()
    elif command == "show-keys":
        cmd_show_keys()
    else:
        cmd_dev(forced_version, quick=quick)

if __name__ == "__main__":
    main()