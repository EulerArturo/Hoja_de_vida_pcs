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
  var spreadsheetId = payload.spreadsheet_id || PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    return jsonResponse({ ok: false, error: "No se definio spreadsheet_id" });
  }

  try {
    ensureFormSubmitTrigger_(spreadsheetId);
  } catch (triggerErr) {
    Logger.log("No se pudo asegurar trigger onFormSubmit en save_technical: " + String(triggerErr));
  }

  var sheetName = payload.sheet_name || "TECNICA_EQUIPOS";
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
  var recordId = (tech.id_equipo || payload.record_id || "").toString().trim();
  if (!recordId) {
    return jsonResponse({ ok: false, error: "Falta ID_EQUIPO en payload tecnico" });
  }

  var existingTechnicalRow = findRowByIdInSheet_(sheet, recordId);
  if (existingTechnicalRow > 0) {
    try {
      var responseSheetDup = detectResponseSheet_(ss, sheetName);
      if (responseSheetDup) {
        writeSyncStatusById_(responseSheetDup, recordId, "DUPLICADO_TECNICO", "ID_EQUIPO ya existe en TECNICA_EQUIPOS. Registro tecnico bloqueado.");
      }
    } catch (dupSyncErr) {
      Logger.log("No se pudo registrar estado por duplicado tecnico: " + String(dupSyncErr));
    }

    return jsonResponse({
      ok: false,
      duplicate: true,
      error: "ID_EQUIPO duplicado en TECNICA_EQUIPOS",
      recordId: recordId,
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

  try {
    registerPendingId_(ss, recordId);
  } catch (ctrlErr) {
    Logger.log("No se pudo registrar ID pendiente: " + String(ctrlErr));
  }

  var resumenStatus = "skip";
  var resumenError = "";
  try {
    refreshResumenSheet_(ss, sheetName);
    resumenStatus = "updated";
  } catch (resErr) {
    resumenStatus = "error";
    resumenError = String(resErr);
  }

  return jsonResponse({
    ok: true,
    saved: true,
    sheet: sheetName,
    recordId: recordId,
    resumen: resumenStatus,
    resumenError: resumenError,
  });
}

var RESPONSE_STATUS_HEADERS_ = [
  "VALIDACION_ESTADO",
  "VALIDACION_DETALLE",
  "SINCRONIZACION_ESTADO",
  "SINCRONIZACION_DETALLE",
  "SINCRONIZACION_FECHA"
];

var REQUIRED_RESPONSE_FIELDS_ = [
  "SEDE",
  "NOMBRES_Y_APELLIDOS",
  "CEDULA_DE_CIUDADANIA",
  "AREA",
  "CARGO",
  "TIPO_DE_EQUIPO",
  "ESTADO_FISICO_DEL_EQUIPO",
  "ID_EQUIPO"
];

var RESPONSE_SHEET_REQUIRED_HEADERS_ = [
  "MARCA_TEMPORAL",
  "SEDE",
  "NOMBRES_Y_APELLIDOS",
  "CEDULA_DE_CIUDADANIA",
  "AREA",
  "CARGO",
  "TIPO_DE_EQUIPO",
  "ID_EQUIPO"
];

var INCIDENCIAS_SHEET_NAME_ = "INCIDENCIAS_FORM";
var CONTROL_IDS_SHEET_NAME_ = "CONTROL_IDS";

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
  for (var i = 0; i < headers.length; i++) {
    if (normalizeHeader_(headers[i]) === "ID_EQUIPO") {
      return i;
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

function getValueByNormalizedHeader_(row, headerMap, headerName) {
  if (!row || !headerMap) {
    return "";
  }
  var idx = headerMap[normalizeHeader_(headerName)];
  if (idx === undefined) {
    return "";
  }
  return row[idx];
}

function getValueByHeaderAliases_(row, headerMap, aliasList) {
  if (!row || !headerMap || !aliasList || !aliasList.length) {
    return "";
  }

  for (var i = 0; i < aliasList.length; i++) {
    var normalizedAlias = normalizeHeader_(aliasList[i]);
    var aliasIdx = headerMap[normalizedAlias];
    if (aliasIdx !== undefined) {
      return row[aliasIdx];
    }
  }

  var headerKeys = Object.keys(headerMap);
  for (var k = 0; k < headerKeys.length; k++) {
    var currentKey = headerKeys[k];
    for (var j = 0; j < aliasList.length; j++) {
      var targetAlias = normalizeHeader_(aliasList[j]);
      if (
        currentKey.indexOf(targetAlias) >= 0 ||
        targetAlias.indexOf(currentKey) >= 0
      ) {
        return row[headerMap[currentKey]];
      }
    }
  }

  return "";
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

function ensureResponseStatusColumns_(responseSheet) {
  var headers = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
  var normalizedHeaders = headers.map(normalizeHeader_);

  for (var i = 0; i < RESPONSE_STATUS_HEADERS_.length; i++) {
    var statusHeader = RESPONSE_STATUS_HEADERS_[i];
    if (normalizedHeaders.indexOf(normalizeHeader_(statusHeader)) < 0) {
      responseSheet.getRange(1, responseSheet.getLastColumn() + 1).setValue(statusHeader);
      headers.push(statusHeader);
      normalizedHeaders.push(normalizeHeader_(statusHeader));
    }
  }

  var headerMap = buildHeaderIndexMap_(headers);
  return {
    headers: headers,
    map: headerMap,
  };
}

function writeValidationAndSyncColumns_(responseSheet, valuesByColumnName) {
  var lastRow = responseSheet.getLastRow();
  if (lastRow < 2) {
    return;
  }

  var headers = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
  var headerMap = buildHeaderIndexMap_(headers);
  var rowCount = lastRow - 1;

  for (var colName in valuesByColumnName) {
    if (!Object.prototype.hasOwnProperty.call(valuesByColumnName, colName)) {
      continue;
    }
    var colIdx = headerMap[normalizeHeader_(colName)];
    if (colIdx === undefined) {
      continue;
    }

    var rawValues = valuesByColumnName[colName] || [];
    var out = [];
    for (var i = 0; i < rowCount; i++) {
      out.push([i < rawValues.length ? rawValues[i] : ""]);
    }
    responseSheet.getRange(2, colIdx + 1, rowCount, 1).setValues(out);
  }
}

function writeSyncStatusById_(responseSheet, recordId, syncStatus, syncDetail) {
  var ensured = ensureResponseStatusColumns_(responseSheet);
  var headers = ensured.headers;
  var headerMap = ensured.map;
  var idIdx = findIdColumnIndex_(headers);
  if (idIdx < 0) {
    return;
  }

  var lastRow = responseSheet.getLastRow();
  if (lastRow < 2) {
    return;
  }

  var rowCount = lastRow - 1;
  var data = responseSheet.getRange(2, 1, rowCount, responseSheet.getLastColumn()).getValues();
  var syncEstadoIdx = headerMap[normalizeHeader_("SINCRONIZACION_ESTADO")];
  var syncDetalleIdx = headerMap[normalizeHeader_("SINCRONIZACION_DETALLE")];
  var syncFechaIdx = headerMap[normalizeHeader_("SINCRONIZACION_FECHA")];

  for (var i = 0; i < data.length; i++) {
    var rowId = (data[i][idIdx] || "").toString().trim();
    if (rowId !== recordId) {
      continue;
    }

    if (syncEstadoIdx !== undefined) {
      responseSheet.getRange(i + 2, syncEstadoIdx + 1).setValue(syncStatus);
    }
    if (syncDetalleIdx !== undefined) {
      responseSheet.getRange(i + 2, syncDetalleIdx + 1).setValue(syncDetail);
    }
    if (syncFechaIdx !== undefined) {
      responseSheet.getRange(i + 2, syncFechaIdx + 1).setValue(nowString_());
    }
  }
}

function ensureIncidenciasSheet_(ss, responseHeaders) {
  var sheet = ss.getSheetByName(INCIDENCIAS_SHEET_NAME_);
  var baseHeaders = [
    "FECHA_INCIDENTE",
    "MOTIVO",
    "ID_EQUIPO",
    "HOJA_ORIGEN",
    "FILA_ORIGEN",
    "RESPUESTA_JSON"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(INCIDENCIAS_SHEET_NAME_);
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

function ensureControlIdsSheet_(ss) {
  var sheet = ss.getSheetByName(CONTROL_IDS_SHEET_NAME_);
  var headers = [
    "FECHA_TECNICO",
    "ID_EQUIPO",
    "ESTADO",
    "FECHA_ESTADO",
    "DETALLE"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(CONTROL_IDS_SHEET_NAME_);
  }

  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function ensureFormSubmitTrigger_(spreadsheetId) {
  if (!spreadsheetId) {
    return;
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
}

function findControlIdRow_(controlSheet, recordId) {
  var lastRow = controlSheet.getLastRow();
  if (lastRow < 2) {
    return -1;
  }

  var ids = controlSheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if ((ids[i][0] || "").toString().trim() === recordId) {
      return i + 2;
    }
  }
  return -1;
}

function registerPendingId_(ss, recordId) {
  var controlSheet = ensureControlIdsSheet_(ss);
  var now = nowString_();
  var row = findControlIdRow_(controlSheet, recordId);

  if (row > 0) {
    controlSheet.getRange(row, 1, 1, 5).setValues([[now, recordId, "PENDIENTE_FORM", now, "Creado por backend tecnico"]]);
    return;
  }

  controlSheet.appendRow([now, recordId, "PENDIENTE_FORM", now, "Creado por backend tecnico"]);
}

function markIdAsUsed_(ss, recordId) {
  var controlSheet = ensureControlIdsSheet_(ss);
  var row = findControlIdRow_(controlSheet, recordId);
  if (row < 2) {
    return;
  }

  var now = nowString_();
  controlSheet.getRange(row, 3).setValue("USADO_FORM");
  controlSheet.getRange(row, 4).setValue(now);
  controlSheet.getRange(row, 5).setValue("Consumido por envio de formulario");
}

function isPendingId_(ss, recordId) {
  var controlSheet = ensureControlIdsSheet_(ss);
  var row = findControlIdRow_(controlSheet, recordId);
  if (row < 2) {
    return false;
  }

  var status = (controlSheet.getRange(row, 3).getValue() || "").toString().trim();
  return status === "PENDIENTE_FORM";
}

function appendIncidencia_(ss, responseSheet, rowNumber, reason, idValue, headers, rowValues) {
  var incidenciaSheet = ensureIncidenciasSheet_(ss, headers);
  var jsonPayload = {};
  for (var i = 0; i < headers.length; i++) {
    jsonPayload[headers[i]] = rowValues[i];
  }

  incidenciaSheet.appendRow([
    nowString_(),
    reason,
    idValue,
    responseSheet.getName(),
    rowNumber,
    JSON.stringify(jsonPayload)
  ]);
}

function rejectDuplicateSubmissionIfNeeded_(e, ss, responseSheet) {
  if (!responseSheet || !ss) {
    return {
      rejected: false,
      message: "No se pudo validar duplicado en caliente"
    };
  }

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
}

function rejectNotPendingIdSubmissionIfNeeded_(e, ss, responseSheet) {
  if (!responseSheet || !ss) {
    return { rejected: false, message: "No se pudo validar ID pendiente" };
  }

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

  if (isPendingId_(ss, submittedId)) {
    return { rejected: false, message: "ID pendiente valido", recordId: submittedId };
  }

  var reason = "ID_NO_PENDIENTE: ID_EQUIPO no autorizado o ya consumido por otro envio";
  appendIncidencia_(ss, responseSheet, submittedRow, reason, submittedId, headers, submittedValues);
  responseSheet.deleteRow(submittedRow);

  return {
    rejected: true,
    message: reason,
    recordId: submittedId,
  };
}

function depurarDuplicadosHistoricos() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Falta SPREADSHEET_ID en Script Properties");
  }

  var technicalSheetName =
    PropertiesService.getScriptProperties().getProperty("TECHNICAL_SHEET_NAME") ||
    "TECNICA_EQUIPOS";
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

  refreshResumenSheet_(ss, technicalSheetName);
  return "Depuracion completada. Duplicados movidos: " + rowsToDelete.length;
}

function validateCedula_(value) {
  var cedula = (value || "").toString().trim();
  if (!cedula) {
    return false;
  }
  return /^[0-9]{6,12}$/.test(cedula);
}

function applyResponseDataQuality_(responseSheet, techById) {
  var ensured = ensureResponseStatusColumns_(responseSheet);
  var headers = ensured.headers;
  var headerMap = ensured.map;

  var idIdx = findIdColumnIndex_(headers);
  if (idIdx < 0) {
    throw new Error("No se encontro columna ID_EQUIPO en hoja de respuestas");
  }

  var lastRow = responseSheet.getLastRow();
  if (lastRow < 2) {
    return;
  }

  var data = responseSheet.getRange(2, 1, lastRow - 1, responseSheet.getLastColumn()).getValues();

  var idCounts = {};
  for (var i = 0; i < data.length; i++) {
    var idVal = (data[i][idIdx] || "").toString().trim();
    if (!idVal) {
      continue;
    }
    idCounts[idVal] = (idCounts[idVal] || 0) + 1;
  }

  var validEstado = [];
  var validDetalle = [];
  var syncEstado = [];
  var syncDetalle = [];
  var syncFecha = [];

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var issues = [];

    for (var req = 0; req < REQUIRED_RESPONSE_FIELDS_.length; req++) {
      var requiredName = REQUIRED_RESPONSE_FIELDS_[req];
      var requiredIdx = headerMap[normalizeHeader_(requiredName)];
      if (requiredIdx === undefined) {
        issues.push("Falta columna obligatoria: " + requiredName);
        continue;
      }
      if (!(row[requiredIdx] || "").toString().trim()) {
        issues.push("Campo obligatorio vacio: " + requiredName);
      }
    }

    var cedulaIdx = headerMap[normalizeHeader_("CEDULA_DE_CIUDADANIA")];
    if (cedulaIdx !== undefined && !validateCedula_(row[cedulaIdx])) {
      issues.push("Cedula invalida: use solo numeros (6 a 12 digitos)");
    }

    var rowId = (row[idIdx] || "").toString().trim();
    if (rowId && (idCounts[rowId] || 0) > 1) {
      issues.push("ID_EQUIPO duplicado en respuestas");
    }

    var isValid = issues.length === 0;
    var validationState = isValid ? "VALIDO" : "INVALIDO";
    var validationDetail = isValid ? "OK" : issues.join(" | ");

    var syncState = "PENDIENTE_TECNICO";
    var syncDetailText = "Pendiente de registro tecnico";
    if (!rowId) {
      syncState = "SIN_ID";
      syncDetailText = "No se puede sincronizar sin ID_EQUIPO";
    } else if ((idCounts[rowId] || 0) > 1) {
      syncState = "DUPLICADO_ID";
      syncDetailText = "Existe mas de una respuesta con el mismo ID_EQUIPO";
    } else if (!isValid) {
      syncState = "BLOQUEADO_VALIDACION";
      syncDetailText = "No sincronizado por validacion";
    } else if (techById && techById[rowId]) {
      syncState = "SINCRONIZADO";
      syncDetailText = "Cruce tecnico encontrado por ID_EQUIPO";
    }

    validEstado.push(validationState);
    validDetalle.push(validationDetail);
    syncEstado.push(syncState);
    syncDetalle.push(syncDetailText);
    syncFecha.push(nowString_());
  }

  writeValidationAndSyncColumns_(responseSheet, {
    "VALIDACION_ESTADO": validEstado,
    "VALIDACION_DETALLE": validDetalle,
    "SINCRONIZACION_ESTADO": syncEstado,
    "SINCRONIZACION_DETALLE": syncDetalle,
    "SINCRONIZACION_FECHA": syncFecha,
  });
}

function isSystemSheet_(name, technicalSheetName) {
  return (
    name === (technicalSheetName || "TECNICA_EQUIPOS") ||
    name === "RESUMEN" ||
    name === INCIDENCIAS_SHEET_NAME_ ||
    name === CONTROL_IDS_SHEET_NAME_
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

function syncControlIdsFromResponses_(ss, responseData, responseIdIdx, techById) {
  if (!responseData || responseData.length < 2 || responseIdIdx < 0) {
    return 0;
  }

  var updated = 0;
  for (var i = 1; i < responseData.length; i++) {
    var row = responseData[i];
    var rowId = (row[responseIdIdx] || "").toString().trim();
    if (!rowId || !techById[rowId]) {
      continue;
    }

    if (!isPendingId_(ss, rowId)) {
      continue;
    }

    markIdAsUsed_(ss, rowId);
    updated += 1;
  }

  return updated;
}

function detectResponseSheet_(ss, technicalSheetName) {
  var configured = PropertiesService.getScriptProperties().getProperty("FORM_RESPONSES_SHEET");
  if (configured) {
    var configuredSheet = ss.getSheetByName(configured);
    if (configuredSheet) {
      return configuredSheet;
    }
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

function refreshResumenSheet_(ss, technicalSheetName) {
  var techSheet = ss.getSheetByName(technicalSheetName || "TECNICA_EQUIPOS");
  if (!techSheet) {
    throw new Error("No existe hoja tecnica: " + technicalSheetName);
  }

  var responseSheet = detectResponseSheet_(ss, technicalSheetName);
  if (!responseSheet) {
    throw new Error("No se encontro hoja de respuestas del formulario");
  }

  var techData = techSheet.getDataRange().getValues();
  if (!techData.length) {
    throw new Error("La hoja tecnica no tiene encabezados");
  }

  var techHeaders = techData[0];
  var techIdIdx = findIdColumnIndex_(techHeaders);
  if (techIdIdx < 0) {
    throw new Error("No se encontro columna ID_EQUIPO en hoja tecnica");
  }
  var techHeaderMap = buildHeaderIndexMap_(techHeaders);

  var techById = {};
  for (var r = 1; r < techData.length; r++) {
    var techRow = techData[r];
    var idValue = (techRow[techIdIdx] || "").toString().trim();
    if (!idValue) {
      continue;
    }
    techById[idValue] = techRow;
  }

  applyResponseDataQuality_(responseSheet, techById);

  var responseData = responseSheet.getDataRange().getValues();
  if (!responseData.length) {
    throw new Error("La hoja de respuestas no tiene encabezados");
  }
  var responseHeaders = responseData[0];
  var responseIdIdx = findIdColumnIndex_(responseHeaders);
  if (responseIdIdx < 0) {
    throw new Error("No se encontro columna ID_EQUIPO en hoja de respuestas");
  }
  var responseHeaderMap = buildHeaderIndexMap_(responseHeaders);

  try {
    syncControlIdsFromResponses_(ss, responseData, responseIdIdx, techById);
  } catch (syncErr) {
    Logger.log("No se pudo sincronizar CONTROL_IDS desde respuestas: " + String(syncErr));
  }

  var output = [];
  var outputHeaders = [
    "MARCA_TEMPORAL",
    "SEDE",
    "NOMBRES_Y_APELLIDOS",
    "CEDULA_DE_CIUDADANIA",
    "AREA",
    "CARGO",
    "TIPO_DE_EQUIPO",
    "TIENE_OTRO_EQUIPO_ASIGNADO",
    "ANYDESK",
    "ESTADO_FISICO_DEL_EQUIPO",
    "OBSERVACIONES_NOVEDADES",
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
    "RAM_GB",
    "VALIDACION_ESTADO",
    "SINCRONIZACION_ESTADO",
    "ESTADO_CRUCE"
  ];
  output.push(outputHeaders);

  for (var rr = 1; rr < responseData.length; rr++) {
    var respRow = responseData[rr];
    var respId = (respRow[responseIdIdx] || "").toString().trim();
    if (!respId && respRow.join("") === "") {
      continue;
    }

    var techMatch = techById[respId];
    var estadoCruce = techMatch ? "OK" : "PENDIENTE_TECNICO";

    var outRow = [
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "MARCA_TEMPORAL"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "SEDE"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "NOMBRES_Y_APELLIDOS"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "CEDULA_DE_CIUDADANIA"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "AREA"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "CARGO"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "TIPO_DE_EQUIPO"),
      getValueByHeaderAliases_(respRow, responseHeaderMap, [
        "TIENE_OTRO_EQUIPO_ASIGNADO",
        "TIENE_OTRO_EQUIPO_ASIGN",
        "OTRO_EQUIPO_ASIGNADO",
        "TIENE_OTRO_EQUIPO"
      ]),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "ANYDESK"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "ESTADO_FISICO_DEL_EQUIPO"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "OBSERVACIONES_NOVEDADES"),
      respId,
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "LINK_A_HOJA_DE_VIDA"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "NOMBRE_EQUIPO"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "SERIAL_BIOS"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "MAC_PRINCIPAL"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "MODELO_EQUIPO"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "DISCOS_PARTICIONES"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "RED_TIPO_CONEXION"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "RED_IPV4"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "RED_VELOCIDAD"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "RAM_RESUMEN"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "OS_NAME"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "OS_VERSION"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "LAST_BOOT"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "CPU"),
      getValueByNormalizedHeader_(techMatch, techHeaderMap, "RAM_GB"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "VALIDACION_ESTADO"),
      getValueByNormalizedHeader_(respRow, responseHeaderMap, "SINCRONIZACION_ESTADO"),
      estadoCruce
    ];

    output.push(outRow);
  }

  var resumenName = "RESUMEN";
  var resumenSheet = ss.getSheetByName(resumenName);
  if (!resumenSheet) {
    resumenSheet = ss.insertSheet(resumenName);
  }

  resumenSheet.clearContents();
  resumenSheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  resumenSheet.setFrozenRows(1);
}

function actualizarResumen() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Falta SPREADSHEET_ID en Script Properties");
  }

  var technicalSheetName =
    PropertiesService.getScriptProperties().getProperty("TECHNICAL_SHEET_NAME") ||
    "TECNICA_EQUIPOS";

  try {
    ensureFormSubmitTrigger_(spreadsheetId);
  } catch (triggerErr) {
    Logger.log("No se pudo asegurar trigger onFormSubmit: " + String(triggerErr));
  }

  var ss = SpreadsheetApp.openById(spreadsheetId);
  refreshResumenSheet_(ss, technicalSheetName);
  return "RESUMEN actualizado";
}

function onFormSubmit(e) {
  try {
    var spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!spreadsheetId) {
      throw new Error("Falta SPREADSHEET_ID en Script Properties");
    }

    var technicalSheetName =
      PropertiesService.getScriptProperties().getProperty("TECHNICAL_SHEET_NAME") ||
      "TECNICA_EQUIPOS";
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var responseSheet = detectResponseSheet_(ss, technicalSheetName);

    var duplicateDecision = rejectDuplicateSubmissionIfNeeded_(e, ss, responseSheet);
    if (duplicateDecision.rejected) {
      Logger.log("Envio rechazado en caliente: " + duplicateDecision.message);
      actualizarResumen();
      return;
    }

    var pendingDecision = rejectNotPendingIdSubmissionIfNeeded_(e, ss, responseSheet);
    if (pendingDecision.rejected) {
      Logger.log("Envio rechazado por ID no pendiente: " + pendingDecision.message);
      actualizarResumen();
      return;
    }

    if (pendingDecision.recordId) {
      markIdAsUsed_(ss, pendingDecision.recordId);
    }

    actualizarResumen();
  } catch (err) {
    Logger.log("No se pudo actualizar RESUMEN en onFormSubmit: " + String(err));
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
