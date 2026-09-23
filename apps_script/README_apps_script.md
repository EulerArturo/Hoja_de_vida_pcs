# Apps Script Web App para subir HTML a Drive

## Objetivo
Recibir desde Python el HTML en base64, crear archivo en Google Drive y devolver URL publica.

## Pasos de despliegue
1. Abre https://script.new con la misma cuenta del formulario.
2. Pega el contenido de Code.gs (archivo de esta carpeta).
3. En Proyecto -> Configuracion del proyecto -> Propiedades del script, agrega:
   - APP_TOKEN = un valor secreto largo
   - DRIVE_FOLDER_ID = ID de la carpeta de Drive donde guardaras los HTML
   - SPREADSHEET_ID = ID de la hoja principal (opcional si lo envias desde config.json)
   - TECHNICAL_SHEET_NAME = nombre exacto de la hoja tecnica
   - FORM_RESPONSES_SHEET = nombre exacto de la hoja de respuestas
   - INCIDENCIAS_SHEET_NAME = nombre de la hoja para duplicados e incidencias
4. Click en Implementar -> Nueva implementacion.
5. Tipo: Aplicacion web.
6. Ejecutar como: tu cuenta.
7. Quien tiene acceso: Cualquiera con el enlace.
8. Copia la URL final que termina en /exec.

9. Ejecuta manualmente la funcion `setupTriggers()` una sola vez desde el
   editor de Apps Script y completa las autorizaciones solicitadas.

## Configurar en Python
En config.json:
- apps_script.web_app_url = URL /exec
- apps_script.token = APP_TOKEN
- apps_script.folder_id = opcional (si no lo pasas, usa DRIVE_FOLDER_ID de propiedades)
- apps_script.spreadsheet_id = ID de la hoja donde guardar tecnico
- apps_script.technical_sheet_name = nombre de pestaña tecnica (ej: TECNICA_EQUIPOS)

## Prueba rapida
1. Ejecuta python hv_pc_form_launcher.py
2. Debe imprimir "HTML subido a Drive: ..."
3. En la hoja, LINK A HOJA DE VIDA debe quedar con la URL devuelta.
4. Esa URL abrira una vista renderizada (no codigo fuente) por el endpoint `doGet` del Apps Script.

## Control de duplicados
- Los envios duplicados del formulario por `ID_EQUIPO` se mueven a `INCIDENCIAS_FORM`.
- El envio duplicado se elimina de la hoja de respuestas para no contaminar la base.

## Procesamiento de envios del formulario
- `setupTriggers()` crea el trigger instalable de `onFormSubmit` y debe ejecutarse una sola vez durante la configuracion inicial.
- `onFormSubmit(e)` detecta y rechaza duplicados nuevos por `ID_EQUIPO`.

## Manejo de incidencias por duplicado
- Hoja de incidencias: `INCIDENCIAS_FORM`.
- Funciones utiles:
   - `onFormSubmit(e)`: detecta y rechaza duplicados nuevos en caliente.
   - `depurarDuplicadosHistoricos()`: mueve duplicados antiguos de respuestas a incidencias y conserva el primer registro.

## Importante despues de cambiar Code.gs
1. Debes volver a Implementar -> Administrar implementaciones -> Editar -> Implementar.
2. Sin redeploy, los cambios de `doGet`/`renderUrl` no se aplican al enlace.

## Nota de seguridad
No compartas APP_TOKEN fuera del equipo de sistemas.
