const fs = require('fs');
const path = require('path');

// 1. Lee el contenido de tu index.ts actual (ajusta la ruta)
const sourcePath = path.join(__dirname, '../src/i18n/old-index.ts'); // copia tu archivo aquí
const content = fs.readFileSync(sourcePath, 'utf-8');

// 2. Extrae el objeto translations usando una regex simple
// NOTA: Esto asume que el objeto comienza con "const translations = {" y termina con "} as const;"
const match = content.match(/const translations = ({[\s\S]*?}) as const;/);
if (!match) throw new Error('No se pudo encontrar el objeto translations');
const objStr = match[1];

// 3. Evaluar el objeto (peligroso, pero controlado)
const translations = eval('(' + objStr + ')'); // { en: {...}, es: {...}, de: {...} }

// 4. Definir qué prefijo pertenece a qué módulo
const moduleMap = {
  nav_: 'common',
  common_: 'common',
  inventory_: 'inventory',
  projects_: 'projects',
  project_: 'projects',
  shop_: 'shop',
  settings_: 'settings',
  create_project_: 'projects',
  scan_wizard_: 'inventory',
  import_: 'inventory',
  packages_: 'packages',
  pkg_: 'packages',
  vcs_: 'vcs',
  ws_: 'workspace',
  preview_3d_: 'preview',
  folders_: 'inventory',
  tags_: 'inventory',
  ctx_: 'inventory',
  card_: 'inventory',
  logs_: 'logs',
  error_boundary_: 'common',
  splash_: 'common',
  compression_: 'compression',
  updates_: 'updates',
  tracker_: 'tracker',
  creators_: 'creators',
  // ... añade todos los prefijos que veas en tus claves
};

// Módulo por defecto
const DEFAULT_MODULE = 'common';

// 5. Para cada idioma, crear archivos
const languages = ['en', 'es', 'de'];
const outDir = path.join(__dirname, '../src/i18n/locales');

for (const lang of languages) {
  const langDir = path.join(outDir, lang);
  if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });
  
  const modulesContent = {};
  
  for (const [key, value] of Object.entries(translations[lang])) {
    let moduleName = DEFAULT_MODULE;
    for (const [prefix, mod] of Object.entries(moduleMap)) {
      if (key.startsWith(prefix)) {
        moduleName = mod;
        break;
      }
    }
    if (!modulesContent[moduleName]) modulesContent[moduleName] = {};
    modulesContent[moduleName][key] = value;
  }
  
  // Escribir cada módulo en su archivo .ts
  for (const [mod, content] of Object.entries(modulesContent)) {
    const filePath = path.join(langDir, `${mod}.ts`);
    const output = `export default ${JSON.stringify(content, null, 2)} as const;\n`;
    fs.writeFileSync(filePath, output);
    console.log(`Generado ${filePath}`);
  }
  
  // Generar el index.ts que agrupa todos los módulos
  const modulesList = Object.keys(modulesContent);
  const imports = modulesList.map(mod => `import ${mod} from './${mod}';`).join('\n');
  const exportObj = `export default {\n  ${modulesList.join(',\n  ')},\n};`;
  const indexContent = `${imports}\n\n${exportObj}\n`;
  fs.writeFileSync(path.join(langDir, 'index.ts'), indexContent);
  console.log(`Generado ${path.join(langDir, 'index.ts')}`);
}

console.log('Migración completada.');