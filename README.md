# RADAR · Inteligencia Político-Digital

App web dinámica que genera dashboards políticos con IA + búsqueda web en tiempo real.

## Estructura del proyecto

```
radar-politico/
├── api/
│   └── analizar.js      ← Backend serverless (llama a Anthropic)
├── public/
│   └── index.html       ← Frontend completo
├── vercel.json          ← Configuración de Vercel
└── README.md
```

## Cómo deployar en Vercel (paso a paso)

### PASO 1 — Crear cuenta en GitHub
1. Ve a https://github.com
2. Crea una cuenta gratuita
3. Haz clic en "New repository"
4. Nómbralo `radar-politico`
5. Déjalo en "Public" y haz clic en "Create repository"

### PASO 2 — Subir los archivos a GitHub
En la página de tu repositorio vacío:
1. Haz clic en "uploading an existing file"
2. Sube los archivos manteniendo la estructura de carpetas:
   - `api/analizar.js`
   - `public/index.html`
   - `vercel.json`
3. Haz clic en "Commit changes"

### PASO 3 — Crear cuenta en Vercel
1. Ve a https://vercel.com
2. Haz clic en "Sign up" → "Continue with GitHub"
3. Autoriza a Vercel acceder a tu GitHub

### PASO 4 — Importar tu proyecto
1. En Vercel, haz clic en "Add New Project"
2. Selecciona tu repositorio `radar-politico`
3. Haz clic en "Import"
4. No cambies nada en la configuración
5. Haz clic en "Deploy" y espera ~1 minuto

### PASO 5 — Agregar tu API key de Anthropic
1. Ve a https://console.anthropic.com
2. Crea una cuenta y genera una API key
3. Copia la API key
4. En Vercel, ve a tu proyecto → Settings → Environment Variables
5. Agrega:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (tu API key)
6. Haz clic en "Save"
7. Ve a Deployments → haz clic en los 3 puntos → "Redeploy"

### PASO 6 — ¡Listo!
Vercel te da una URL pública tipo:
`https://radar-politico.vercel.app`

Compártela con quien quieras.

## Costos estimados
- Vercel: $0 (plan gratuito)
- Anthropic API: ~$0.02 por análisis
- Crédito inicial gratuito de Anthropic: $5 USD (~250 análisis gratis)
