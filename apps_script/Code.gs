function doPost(e) {
  try {
    var payload = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : "{}");

    var configuredToken = PropertiesService.getScriptProperties().getProperty("APP_TOKEN");
    if (configuredToken && payload.token !== configuredToken) {
      return jsonResponse({ ok: false, error: "Token invalido" });
    }

    var folderId = payload.folder_id || PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_ID");
    if (!folderId) {
      return jsonResponse({ ok: false, error: "No se definio folder_id" });
    }

    if (!payload.file_name || !payload.content_base64) {
      return jsonResponse({ ok: false, error: "Faltan file_name o content_base64" });
    }

    var bytes = Utilities.base64Decode(payload.content_base64);
    var mimeType = payload.mime_type || "text/html";
    var blob = Utilities.newBlob(bytes, mimeType, payload.file_name);

    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var baseWebAppUrl = ScriptApp.getService().getUrl();
    var renderUrl = baseWebAppUrl ? (baseWebAppUrl + "?fileId=" + encodeURIComponent(file.getId())) : "";

    return jsonResponse({
      ok: true,
      fileId: file.getId(),
      url: file.getUrl(),
      renderUrl: renderUrl,
      recordId: payload.record_id || ""
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    var fileId = (e && e.parameter && e.parameter.fileId) ? e.parameter.fileId : "";
    if (!fileId) {
      return HtmlService.createHtmlOutput("<h3>Falta fileId</h3><p>Usa ?fileId=ID_ARCHIVO</p>");
    }

    var file = DriveApp.getFileById(fileId);
    var htmlContent = file.getBlob().getDataAsString("UTF-8");
    return HtmlService.createHtmlOutput(htmlContent)
      .setTitle(file.getName())
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput("<h3>Error al cargar archivo</h3><pre>" + String(err) + "</pre>");
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
