function doPost(e) {
  try {
    var payload = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : "{}");
    var action = (payload.action || "upload_html").toString();

    var configuredToken = PropertiesService.getScriptProperties().getProperty("APP_TOKEN");
    if (configuredToken && payload.token !== configuredToken) {
      return jsonResponse({ ok: false, error: "Token invalido" });
    }

    if (action === "save_technical") {
      return saveTechnicalRecord(payload);
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

function saveTechnicalRecord(payload) {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty("SPREADSHEET_ID") || payload.spreadsheet_id;
  if (!spreadsheetId) {
    return jsonResponse({ ok: false, error: "No se definio spreadsheet_id" });
  }

  var sheetName = properties.getProperty("TECHNICAL_SHEET_NAME") || payload.sheet_name;
  if (!sheetName) {
    return jsonResponse({ ok: false, error: "No se definio technical_sheet_name" });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return jsonResponse({ ok: false, error: "No se pudo adquirir el bloqueo de guardado" });
  }

  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    var headers = [
      "FECHA_REGISTRO",
      "ID_EQUIPO",
      "LINK_A_HOJA_DE_VIDA",
      "NOMBRE_EQUIPO",
      "SERIAL_BIOS",
      "MAC_PRINCIPAL",
      "MODELO_EQUIPO",
      "DISCOS_PARTICIONES",
      "RED_TIPO_CONEXION",
      "RED_IPV4",
      "RED_VELOCIDAD",
      "RAM_RESUMEN",
      "OS_NAME",
      "OS_VERSION",
      "LAST_BOOT",
      "CPU",
      "RAM_GB"
    ];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    }

    var tech = payload.technical || {};
    var recordId = (payload.record_id || tech.id_equipo || "").toString().trim();
    if (!/^HV-[0-9]{8}-[0-9]{6}-[A-Z0-9]{6}$/.test(recordId)) {
      return jsonResponse({
        ok: false,
        error: "ID_EQUIPO invalido. Se esperaba un codigo HV-YYYYMMDD-HHMMSS-XXXXXX",
        received: recordId,
      });
    }

    var row = [
      payload.generated_at || new Date(),
      recordId,
      tech.link_hoja_vida || "",
      tech.nombre_equipo || "",
      tech.serial_bios || "",
      tech.mac_principal || "",
      tech.modelo_equipo || "",
      tech.discos_particiones || "",
      tech.red_tipo_conexion || "",
      tech.red_ipv4 || "",
      tech.red_velocidad || "",
      tech.ram_resumen || "",
      tech.os_name || "",
      tech.os_version || "",
      tech.last_boot || "",
      tech.cpu || "",
      tech.ram_gb || ""
    ];

    sheet.appendRow(row);

    return jsonResponse({
      ok: true,
      saved: true,
      sheet: sheetName,
      recordId: recordId,
    });
  } finally {
    lock.releaseLock();
  }
}

var RESPONSE_SHEET_REQUIRED_HEADERS_ = ["MARCA_TEMPORAL","SEDE","NOMBRES_Y_APELLIDOS","CEDULA_DE_CIUDADANIA","AREA","CARGO","TIPO_DE_EQUIPO","SERIAL_BIOS"];

function getRequiredScriptProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error("Falta " + name + " en Script Properties");
  }
  return value;
}

function getTechnicalSheetName_() {
  return getRequiredScriptProperty_("TECHNICAL_SHEET_NAME");
}

function getResponseSheetName_() {
  return getRequiredScriptProperty_("FORM_RESPONSES_SHEET");
}

function getIncidenciasSheetName_() {
  return getRequiredScriptProperty_("INCIDENCIAS_SHEET_NAME");
}

function normalizeHeader_(text) {
  var value = (text || "").toString().trim().toUpperCase();
  value = value
    .replace(/\u00c1/g, "A")
    .replace(/\u00c9/g, "E")
    .replace(/\u00cd/g, "I")
    .replace(/\u00d3/g, "O")
    .replace(/\u00da/g, "U")
    .replace(/\u00dc/g, "U")
    .replace(/\u00d1/g, "N");
  return value.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function findIdColumnIndex_(headers) {
  // ID_EQUIPO is the registration key used to link the form and technical sheet.
  for (var i = 0; i < headers.length; i++) {
    var n = normalizeHeader_(headers[i]);
    if (n === "ID_EQUIPO") {
      return i;
    }
  }

  // Fallback for older sheets without ID_EQUIPO.
  for (var j = 0; j < headers.length; j++) {
    var fallbackName = normalizeHeader_(headers[j]);
    if (fallbackName === "SERIAL_BIOS" || fallbackName.indexOf("SERIAL") >= 0) {
      return j;
    }
  }
  return -1;
}

function nowString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function buildHeaderIndexMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[normalizeHeader_(headers[i])] = i;
  }
  return map;
}

function findRowByIdInSheet_(sheet, idValue) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return -1;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idIdx = findIdColumnIndex_(headers);
  if (idIdx < 0) {
    return -1;
  }

  var idRange = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idRange.length; i++) {
    if ((idRange[i][0] || "").toString().trim() === idValue) {
      return i + 2;
    }
  }

  return -1;
}

function ensureIncidenciasSheet_(ss, responseHeaders) {
  var sheetName = getIncidenciasSheetName_();
  var sheet = ss.getSheetByName(sheetName);
  var baseHeaders = [
    "FECHA_INCIDENTE",
    "MOTIVO",
    "ID_EQUIPO",
    "HOJA_ORIGEN",
    "FILA_ORIGEN",
    "RESPUESTA_JSON"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    sheet.appendRow(baseHeaders);
    return sheet;
  }

  var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (normalizeHeader_(currentHeaders[0]) !== normalizeHeader_("FECHA_INCIDENTE")) {
    sheet.clearContents();
    sheet.appendRow(baseHeaders);
  }

  return sheet;
}

function setupTriggers() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Falta SPREADSHEET_ID en Script Properties");
  }

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    if (trigger.getHandlerFunction() !== "onFormSubmit") {
      continue;
    }
    if (trigger.getEventType() !== ScriptApp.EventType.ON_FORM_SUBMIT) {
      continue;
    }

    var sourceId = "";
    try {
      sourceId = (trigger.getTriggerSourceId() || "").toString();
    } catch (sourceErr) {
      sourceId = "";
    }

    if (!sourceId || sourceId === spreadsheetId) {
      return;
    }
  }

  ScriptApp
    .newTrigger("onFormSubmit")
    .forSpreadsheet(spreadsheetId)
    .onFormSubmit()
    .create();

  Logger.log("Trigger onFormSubmit configurado para el spreadsheet " + spreadsheetId);
}

function appendIncidencia_(ss, responseSheet, rowNumber, reason, idValue, headers, rowValues) {
  var incidenciaSheet = ensureIncidenciasSheet_(ss, headers);
  var jsonPayload = {};
  for (var i = 0; i < headers.length; i++) {
    jsonPayload[headers[i]] = rowValues[i];
  }
  incidenciaSheet.appendRow([nowString_(), reason, idValue, responseSheet.getName(), rowNumber, JSON.stringify(jsonPayload)]);
}

function rejectDuplicateSubmissionIfNeeded_(e, ss, responseSheet) {
  if (!responseSheet || !ss) {
    return {
      rejected: false,
      message: "No se pudo validar duplicado en caliente"
    };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { rejected: false, message: "No se pudo adquirir el bloqueo de duplicados" };
  }

  try {
    var lastCol = responseSheet.getLastColumn();
    var lastRow = responseSheet.getLastRow();
    if (lastRow < 2 || lastCol < 1) {
      return { rejected: false, message: "Sin datos para validar" };
    }

    var headers = responseSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var idIdx = findIdColumnIndex_(headers);
    if (idIdx < 0) {
      return { rejected: false, message: "No existe columna ID_EQUIPO" };
    }

    var submittedRow = (e && e.range && e.range.getSheet().getName() === responseSheet.getName())
      ? e.range.getRow()
      : lastRow;
    if (submittedRow < 2 || submittedRow > lastRow) {
      submittedRow = lastRow;
    }

    var submittedValues = responseSheet.getRange(submittedRow, 1, 1, lastCol).getValues()[0];
    var submittedId = (submittedValues[idIdx] || "").toString().trim();
    if (!submittedId) {
      return { rejected: false, message: "Envio sin ID_EQUIPO" };
    }

    var ids = responseSheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    var existingRow = -1;
    for (var i = 0; i < ids.length; i++) {
      var rowNum = i + 2;
      if (rowNum === submittedRow) {
        continue;
      }

      if ((ids[i][0] || "").toString().trim() === submittedId) {
        existingRow = rowNum;
        break;
      }
    }

    if (existingRow < 0) {
      return { rejected: false, message: "Sin duplicado" };
    }

    var reason = "ENVIO_DUPLICADO_FORM: ID_EQUIPO ya existe en fila " + existingRow;
    appendIncidencia_(ss, responseSheet, submittedRow, reason, submittedId, headers, submittedValues);
    responseSheet.deleteRow(submittedRow);

    return {
      rejected: true,
      message: reason,
      recordId: submittedId,
      existingRow: existingRow,
    };
  } finally {
    lock.releaseLock();
  }
}

function depurarDuplicadosHistoricos() {
  var spreadsheetId = getRequiredScriptProperty_("SPREADSHEET_ID");
  var technicalSheetName = getTechnicalSheetName_();
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var responseSheet = detectResponseSheet_(ss, technicalSheetName);
  if (!responseSheet) {
    throw new Error("No se encontro hoja de respuestas");
  }
  var lastCol = responseSheet.getLastColumn();
  var lastRow = responseSheet.getLastRow();
  if (lastRow < 2) {
    return "Sin respuestas para depurar";
  }
  var headers = responseSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idIdx = findIdColumnIndex_(headers);
  if (idIdx < 0) {
    throw new Error("No existe columna ID_EQUIPO en respuestas");
  }
  var data = responseSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var firstSeen = {};
  var rowsToDelete = [];
  for (var i = 0; i < data.length; i++) {
    var rowNumber = i + 2;
    var row = data[i];
    var idValue = (row[idIdx] || "").toString().trim();
    if (!idValue) {
      continue;
    }
    if (!firstSeen[idValue]) {
      firstSeen[idValue] = rowNumber;
      continue;
    }
    var reason = "DUPLICADO_HISTORICO: ID_EQUIPO repetido, se conserva fila " + firstSeen[idValue];
    appendIncidencia_(ss, responseSheet, rowNumber, reason, idValue, headers, row);
    rowsToDelete.push(rowNumber);
  }
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var d = 0; d < rowsToDelete.length; d++) {
    responseSheet.deleteRow(rowsToDelete[d]);
  }
  return "Depuracion completada. Duplicados movidos: " + rowsToDelete.length;
}

function isSystemSheet_(name, technicalSheetName) {
  return (
    name === technicalSheetName ||
    name === getIncidenciasSheetName_()
  );
}

function getSheetHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) {
    return [];
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function computeResponseSheetScore_(sheet) {
  var name = sheet.getName();
  var normalizedName = normalizeHeader_(name);
  var headers = getSheetHeaders_(sheet);
  var hasIdHeader = findIdColumnIndex_(headers) >= 0;
  var rowCount = sheet.getLastRow();

  var nameLooksLikeResponses = (
    normalizedName.indexOf("RESPUESTAS") >= 0 ||
    normalizedName.indexOf("FORM_RESPONSES") >= 0
  );

  var score = 0;
  if (nameLooksLikeResponses) {
    score += 100;
  }
  if (hasIdHeader) {
    score += 50;
  }
  if (rowCount > 1) {
    score += 10;
  }

  var headerMap = buildHeaderIndexMap_(headers);
  var requiredFound = 0;
  for (var i = 0; i < RESPONSE_SHEET_REQUIRED_HEADERS_.length; i++) {
    if (headerMap[normalizeHeader_(RESPONSE_SHEET_REQUIRED_HEADERS_[i])] !== undefined) {
      requiredFound += 1;
    }
  }
  score += requiredFound * 8;

  return {
    score: score,
    rowCount: rowCount,
    hasIdHeader: hasIdHeader,
    nameLooksLikeResponses: nameLooksLikeResponses,
    requiredFound: requiredFound,
  };
}

function detectResponseSheet_(ss, technicalSheetName) {
  var configured = getResponseSheetName_();
  var configuredSheet = ss.getSheetByName(configured);
  if (configuredSheet) {
    return configuredSheet;
  }

  var allSheets = ss.getSheets();
  var bestSheet = null;
  var bestMeta = null;

  for (var i = 0; i < allSheets.length; i++) {
    var currentSheet = allSheets[i];
    var name = currentSheet.getName();
    if (isSystemSheet_(name, technicalSheetName)) {
      continue;
    }

    var meta = computeResponseSheetScore_(currentSheet);
    if (!(meta.nameLooksLikeResponses || meta.hasIdHeader)) {
      continue;
    }

    if (!bestSheet) {
      bestSheet = currentSheet;
      bestMeta = meta;
      continue;
    }

    if (meta.score > bestMeta.score) {
      bestSheet = currentSheet;
      bestMeta = meta;
      continue;
    }

    if (meta.score === bestMeta.score && meta.rowCount > bestMeta.rowCount) {
      bestSheet = currentSheet;
      bestMeta = meta;
    }
  }

  return bestSheet;
}

function limpiarColumnasAuxiliaresRespuestas() {
  var spreadsheetId = getRequiredScriptProperty_("SPREADSHEET_ID");
  var responseSheetName = getResponseSheetName_();
  var auxiliaryHeaders = [
    "VALIDACION_ESTADO",
    "VALIDACION_DETALLE",
    "SINCRONIZACION_ESTADO",
    "SINCRONIZACION_DETALLE",
    "SINCRONIZACION_FECHA"
  ];

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var responseSheet = ss.getSheetByName(responseSheetName);
  if (!responseSheet) {
    throw new Error("No se encontro la hoja " + responseSheetName);
  }

  var headers = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
  var normalize = function(value) {
    return (value || "").toString().trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  };
  var normalizedAuxiliaryHeaders = auxiliaryHeaders.map(normalize);
  var deleted = 0;
  for (var col = headers.length - 1; col >= 0; col--) {
    if (normalizedAuxiliaryHeaders.indexOf(normalize(headers[col])) >= 0) {
      responseSheet.deleteColumn(col + 1);
      deleted += 1;
    }
  }

  return "Columnas auxiliares eliminadas: " + deleted;
}

function ordenarRespuestasPorFechaAscendente() {
  var spreadsheet = SpreadsheetApp.openById(getRequiredScriptProperty_("SPREADSHEET_ID"));
  var responseSheet = spreadsheet.getSheetByName(getResponseSheetName_());

  if (!responseSheet) {
    throw new Error("No se encontro la hoja de respuestas configurada");
  }

  var lastRow = responseSheet.getLastRow();
  var lastColumn = responseSheet.getLastColumn();
  if (lastRow < 3 || lastColumn < 1) {
    return "No hay suficientes respuestas para ordenar.";
  }

  responseSheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .sort({ column: 1, ascending: true });

  return "Respuestas ordenadas por Marca temporal. La mas reciente queda al final.";
}

function onFormSubmit(e) {
  try {
    var spreadsheetId = getRequiredScriptProperty_("SPREADSHEET_ID");
    var technicalSheetName = getTechnicalSheetName_();
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var responseSheet = detectResponseSheet_(ss, technicalSheetName);
    var duplicateDecision = rejectDuplicateSubmissionIfNeeded_(e, ss, responseSheet);
    if (duplicateDecision.rejected) {
      Logger.log("Envio rechazado en caliente: " + duplicateDecision.message);
      return;
    }
  } catch (err) {
    Logger.log("No se pudo procesar el envio del formulario: " + String(err));
  }
}

function escapeHtml_(value) {
  return (value || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    return HtmlService.createHtmlOutput(
      "<h3>Error al cargar archivo</h3><pre>" + escapeHtml_(String(err)) + "</pre>"
    );
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
