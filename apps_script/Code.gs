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
  var row = [
    payload.generated_at || new Date(),
    tech.id_equipo || payload.record_id || "",
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
    recordId: payload.record_id || "",
    resumen: resumenStatus,
    resumenError: resumenError,
  });
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
  for (var i = 0; i < headers.length; i++) {
    if (normalizeHeader_(headers[i]) === "ID_EQUIPO") {
      return i;
    }
  }
  return -1;
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
  for (var i = 0; i < allSheets.length; i++) {
    var name = allSheets[i].getName();
    if (name === technicalSheetName || name === "RESUMEN") {
      continue;
    }
    var normalized = normalizeHeader_(name);
    if (
      normalized.indexOf("RESPUESTAS") >= 0 ||
      normalized.indexOf("FORM_RESPONSES") >= 0
    ) {
      return allSheets[i];
    }
  }

  return null;
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

  var responseData = responseSheet.getDataRange().getValues();
  var techData = techSheet.getDataRange().getValues();
  if (!responseData.length) {
    throw new Error("La hoja de respuestas no tiene encabezados");
  }
  if (!techData.length) {
    throw new Error("La hoja tecnica no tiene encabezados");
  }

  var responseHeaders = responseData[0];
  var techHeaders = techData[0];
  var responseIdIdx = findIdColumnIndex_(responseHeaders);
  var techIdIdx = findIdColumnIndex_(techHeaders);
  if (responseIdIdx < 0) {
    throw new Error("No se encontro columna ID_EQUIPO en hoja de respuestas");
  }
  if (techIdIdx < 0) {
    throw new Error("No se encontro columna ID_EQUIPO en hoja tecnica");
  }

  var techKeepIndexes = [];
  var techOutputHeaders = [];
  for (var h = 0; h < techHeaders.length; h++) {
    if (h === techIdIdx) {
      continue;
    }
    techKeepIndexes.push(h);
    techOutputHeaders.push("TEC_" + techHeaders[h]);
  }

  var techById = {};
  for (var r = 1; r < techData.length; r++) {
    var techRow = techData[r];
    var idValue = (techRow[techIdIdx] || "").toString().trim();
    if (!idValue) {
      continue;
    }
    techById[idValue] = techRow;
  }

  var output = [];
  var outputHeaders = responseHeaders.concat(techOutputHeaders).concat(["ESTADO_CRUCE"]);
  output.push(outputHeaders);

  for (var rr = 1; rr < responseData.length; rr++) {
    var respRow = responseData[rr];
    var respId = (respRow[responseIdIdx] || "").toString().trim();
    if (!respId && respRow.join("") === "") {
      continue;
    }

    var techMatch = techById[respId];
    var techValues = [];
    for (var k = 0; k < techKeepIndexes.length; k++) {
      var col = techKeepIndexes[k];
      techValues.push(techMatch ? techMatch[col] : "");
    }

    var estadoCruce = techMatch ? "OK" : "PENDIENTE_TECNICO";
    output.push(respRow.concat(techValues).concat([estadoCruce]));
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

  var ss = SpreadsheetApp.openById(spreadsheetId);
  refreshResumenSheet_(ss, technicalSheetName);
  return "RESUMEN actualizado";
}

function onFormSubmit(e) {
  try {
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
