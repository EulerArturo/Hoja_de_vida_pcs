# Hoja de Vida de Equipos PC

Automatiza el registro de activos de TI en campo:

- Recolecta informacion tecnica del equipo (hardware, red, almacenamiento, RAM, GPU, SO).
- Genera hoja de vida en HTML.
- Sube el HTML a Google Drive.
- Abre Google Forms prellenado con datos tecnicos.
- Guarda la trazabilidad en Google Sheets.

## Caracteristicas

- ID unico por registro (`HV-YYYYMMDD-HHMMSS-XXXXXX`).
- Integracion con Google Forms (prefill por `entry.*`).
- Integracion con Apps Script Web App para subida a Drive.
- Enlace renderizado del HTML desde Apps Script (`doGet?fileId=...`).
- Salida lista para soporte e inventario.

## Estructura

- `hv_pc_form_launcher.py`: Script principal.
- `config.example.json`: Plantilla de configuracion.
- `config.json`: Configuracion local de ejecucion.
- `apps_script/Code.gs`: Backend Apps Script (upload + render).
- `apps_script/README_apps_script.md`: Despliegue Apps Script.
- `README_python_flujo.md`: Flujo tecnico detallado.
- `dist/hv_pc_form_launcher.exe`: Ejecutable de produccion.

## Requisitos

- Windows con PowerShell.
- Python 3.10+ (si ejecutas script fuente).
- Cuenta Google con acceso a Forms/Sheets/Drive.
- Apps Script Web App desplegada.

## Configuracion Rapida

1. Copia `config.example.json` a `config.json`.
2. Llena:
   - URL del Form (`form_view_url`).
   - `entry_ids` del Form.
   - Apps Script (`web_app_url`, `token`, `folder_id`).
3. Prueba local:

```powershell
python hv_pc_form_launcher.py
```

## Ejecucion en Produccion

Desde el paquete generado:

1. Mantener juntos en la misma carpeta:
   - `hv_pc_form_launcher.exe`
   - `config.json`
2. Ejecutar `hv_pc_form_launcher.exe`.

## Compilacion EXE

```powershell
python -m PyInstaller --onefile --noconfirm --clean --name hv_pc_form_launcher hv_pc_form_launcher.py
```

## Seguridad

- No compartas `APP_TOKEN` fuera del equipo de sistemas.
- Evita publicar `config.json` con credenciales reales.
- Si un token se expone, rotalo en Apps Script y actualiza `config.json`.

## Estado

Version estable para uso operativo interno.
