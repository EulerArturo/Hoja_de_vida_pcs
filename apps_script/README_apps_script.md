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
   - TECHNICAL_SHEET_NAME = nombre de la hoja tecnica (opcional, por defecto TECNICA_EQUIPOS)
   - FORM_RESPONSES_SHEET = nombre exacto de la hoja de respuestas (opcional, autodetecta si no se define)
4. Click en Implementar -> Nueva implementacion.
5. Tipo: Aplicacion web.
6. Ejecutar como: tu cuenta.
7. Quien tiene acceso: Cualquiera con el enlace.
8. Copia la URL final que termina en /exec.

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

## Endurecimiento de calidad de datos (incluido)
- Bloqueo de duplicados por `ID_EQUIPO` en `TECNICA_EQUIPOS`.
- Rechazo en caliente de envios duplicados del formulario por `ID_EQUIPO`.
   - El envio duplicado se mueve a `INCIDENCIAS_FORM`.
   - Se elimina de la hoja de respuestas para no contaminar la base.
- Validacion de hoja de respuestas:
   - Campos obligatorios vacios.
   - Cedula valida: solo numeros, 6 a 12 digitos.
   - Duplicados por `ID_EQUIPO` en respuestas.
- Registro de estados en la hoja de respuestas con columnas:
   - `VALIDACION_ESTADO`
   - `VALIDACION_DETALLE`
   - `SINCRONIZACION_ESTADO`
   - `SINCRONIZACION_DETALLE`
   - `SINCRONIZACION_FECHA`

## Actualizacion de hoja RESUMEN
- `actualizarResumen()` reconstruye la hoja `RESUMEN` cruzando por `ID_EQUIPO`.
- `onFormSubmit(e)` intenta refrescar RESUMEN en cada envio del formulario (recomendado crear trigger instalable).

## Manejo de incidencias por duplicado
- Hoja de incidencias: `INCIDENCIAS_FORM`.
- Funciones utiles:
   - `onFormSubmit(e)`: detecta y rechaza duplicados nuevos en caliente.
   - `depurarDuplicadosHistoricos()`: mueve duplicados antiguos de respuestas a incidencias, conserva el primer registro y actualiza RESUMEN.

## Control de ID pendiente (anti-manipulacion)
- Hoja de control: `CONTROL_IDS`.
- Flujo:
   - Al guardar tecnico por backend, el ID queda en estado `PENDIENTE_FORM`.
   - Al enviar formulario, solo se acepta ese ID si esta `PENDIENTE_FORM`.
   - Si el usuario cambia el ID por otro no autorizado o ya usado, el envio se rechaza en caliente, se mueve a `INCIDENCIAS_FORM` y se elimina de respuestas.
   - Si el envio es valido, el ID pasa a estado `USADO_FORM`.

## Importante despues de cambiar Code.gs
1. Debes volver a Implementar -> Administrar implementaciones -> Editar -> Implementar.
2. Sin redeploy, los cambios de `doGet`/`renderUrl` no se aplican al enlace.

## Nota de seguridad
No compartas APP_TOKEN fuera del equipo de sistemas.
