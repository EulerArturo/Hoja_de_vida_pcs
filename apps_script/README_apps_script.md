# Apps Script Web App para subir HTML a Drive

## Objetivo
Recibir desde Python el HTML en base64, crear archivo en Google Drive y devolver URL publica.

## Pasos de despliegue
1. Abre https://script.new con la misma cuenta del formulario.
2. Pega el contenido de Code.gs (archivo de esta carpeta).
3. En Proyecto -> Configuracion del proyecto -> Propiedades del script, agrega:
   - APP_TOKEN = un valor secreto largo
   - DRIVE_FOLDER_ID = ID de la carpeta de Drive donde guardaras los HTML
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

## Prueba rapida
1. Ejecuta python hv_pc_form_launcher.py
2. Debe imprimir "HTML subido a Drive: ..."
3. En la hoja, LINK A HOJA DE VIDA debe quedar con la URL devuelta.
4. Esa URL abrira una vista renderizada (no codigo fuente) por el endpoint `doGet` del Apps Script.

## Importante despues de cambiar Code.gs
1. Debes volver a Implementar -> Administrar implementaciones -> Editar -> Implementar.
2. Sin redeploy, los cambios de `doGet`/`renderUrl` no se aplican al enlace.

## Nota de seguridad
No compartas APP_TOKEN fuera del equipo de sistemas.
