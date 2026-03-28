# Flujo Python + Google Form + Apps Script

Este script genera automaticamente:
- ID tecnico (`HV-YYYYMMDD-HHMMSS-XXXXXX`)
- HTML del equipo
- Subida opcional del HTML a Drive por Apps Script
- URL prellenada del formulario con columnas tecnicas

## Modo recomendado (bloquear edicion de datos tecnicos)
Para que el usuario NO pueda modificar datos tecnicos:
1. Deja en el Form solo campos humanos (sede, nombre, cedula, area, etc.).
2. Conserva solo `ID_EQUIPO` como campo tecnico en el Form (opcional, para trazabilidad).
3. El script guarda datos tecnicos directamente en la hoja `TECNICA_EQUIPOS` via Apps Script (`action=save_technical`).
4. El formulario solo captura lo humano; lo tecnico ya no depende del usuario.

Luego abre el formulario para que el usuario complete solo los datos humanos.

## Archivos
- `hv_pc_form_launcher.py`
- `config.json` (crear copiando `config.example.json`)

## Que links y datos debes pasar
1. `form_view_url`:
   - URL publica de tu formulario en modo `viewform`.
2. `entry_ids` tecnicos:
   - `id_equipo`
   - `link_hoja_vida`
   - `nombre_equipo`
   - `serial_bios`
   - `mac_principal`
   - `modelo_equipo`
3. `output_dir`:
   - Carpeta donde guardar HTML.
4. Opcional `html_public_base_url`:
   - Si usas carpeta compartida con URL publica, se arma link completo para la hoja.
5. Opcional `apps_script`:
   - `web_app_url`: URL `/exec` de Apps Script Web App.
   - `token`: Token secreto para validar peticiones.
   - `folder_id`: Carpeta destino en Drive (si no se envia, Apps Script usa su propiedad).

## Como sacar cada entry ID
1. En Google Forms abre menu de 3 puntos.
2. Click en "Obtener enlace prellenado".
3. Escribe un valor de prueba en todos los campos tecnicos.
4. Genera enlace y copialo.
5. En la URL veras parametros tipo `entry.123456789=valor`.
6. Ese `entry.123456789` es el que va en `config.json`.

## Ejecutar
1. Copia `config.example.json` a `config.json`.
2. Llena tus datos reales.
3. Ejecuta:

```powershell
python hv_pc_form_launcher.py
```

## Prioridad del link en LINK A HOJA DE VIDA
1. Si `apps_script.web_app_url` esta configurado y responde OK, se usa la URL de Drive devuelta por Apps Script.
2. Si falla o no esta configurado, usa `html_public_base_url` (si existe).
3. Si tampoco existe, guarda ruta local del HTML.

## Despliegue Apps Script
1. Revisa `apps_script/Code.gs`.
2. Sigue `apps_script/README_apps_script.md`.
3. Copia `web_app_url` y `token` en `config.json`.

## Empaquetar a EXE
```powershell
pip install pyinstaller
pyinstaller --onefile --name hv_pc_form_launcher hv_pc_form_launcher.py
```

El exe quedara en `dist\\hv_pc_form_launcher.exe`.
