"""Cliente HTTP para el Web App de Google Apps Script."""

from __future__ import annotations

import base64
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from requests import Response
from requests.exceptions import ConnectionError as RequestsConnectionError
from requests.exceptions import HTTPError, RequestException, Timeout

from .collector import build_disks_summary, build_network_summary, build_ram_summary

REQUEST_TIMEOUT_SECONDS = 60


class AppsScriptError(RuntimeError):
    """Representa un error funcional devuelto por Apps Script."""


class AppsScriptTransportError(RuntimeError):
    """Representa un error de red o transporte al invocar Apps Script."""


def _post_json(web_app_url: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Envía un payload JSON y valida la respuesta del Web App.

    Args:
        web_app_url: URL de la implementación de Apps Script.
        payload: Cuerpo JSON de la operación solicitada.

    Returns:
        dict[str, Any]: Respuesta JSON exitosa.

    Raises:
        AppsScriptTransportError: Si falla la comunicación HTTP.
        AppsScriptError: Si la respuesta no es válida o indica un error.
    """
    try:
        response: Response = requests.post(
            web_app_url,
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except Timeout as exc:
        message = "Tiempo de espera agotado al contactar Apps Script"
        raise AppsScriptTransportError(message) from exc
    except RequestsConnectionError as exc:
        message = "No fue posible conectar con Apps Script"
        raise AppsScriptTransportError(message) from exc
    except HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "desconocido"
        message = f"Apps Script devolvio HTTP {status}"
        raise AppsScriptTransportError(message) from exc
    except RequestException as exc:
        message = f"Error HTTP al contactar Apps Script: {exc}"
        raise AppsScriptTransportError(message) from exc

    try:
        data = response.json()
    except ValueError as exc:
        message = "Apps Script devolvio una respuesta JSON invalida"
        raise AppsScriptError(message) from exc

    if not isinstance(data, dict):
        message = "Apps Script devolvio una respuesta con formato inesperado"
        raise AppsScriptError(message)
    if not data.get("ok"):
        raise AppsScriptError(str(data.get("error") or "Apps Script devolvio un error"))
    return data


def _apps_script_config(config: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Extrae la URL y configuración del bloque Apps Script.

    Args:
        config: Configuración completa del cliente.

    Returns:
        tuple[str, dict[str, Any]]: URL del Web App y sus opciones.
    """
    apps_script = config.get("apps_script") or {}
    web_app_url = (apps_script.get("web_app_url") or "").strip()
    return web_app_url, apps_script


def upload_html_with_apps_script(record_id: str, html_path: Path, config: dict[str, Any]) -> str:
    """Sube el informe HTML y devuelve su enlace de visualización.

    Args:
        record_id: Identificador del registro técnico.
        html_path: Ruta del informe HTML local.
        config: Configuración completa del cliente.

    Returns:
        str: URL renderizada por Apps Script o cadena vacía si está deshabilitado.
    """
    web_app_url, apps_script = _apps_script_config(config)
    if not web_app_url:
        return ""

    payload = {
        "action": "upload_html",
        "token": apps_script.get("token", ""),
        "record_id": record_id,
        "file_name": html_path.name,
        "mime_type": "text/html",
        "content_base64": base64.b64encode(html_path.read_bytes()).decode("ascii"),
        "folder_id": (apps_script.get("folder_id") or "").strip(),
    }
    data = _post_json(web_app_url, payload)
    return (data.get("renderUrl") or data.get("url") or "").strip()


def save_technical_record_with_apps_script(
    record_id: str,
    html_link: str,
    pc: dict[str, Any],
    config: dict[str, Any],
) -> None:
    """Guarda el resumen técnico del equipo en Google Sheets.

    Args:
        record_id: Identificador de la hoja de vida.
        html_link: Enlace local o remoto al informe.
        pc: Inventario técnico recolectado.
        config: Configuración completa del cliente.

    Raises:
        AppsScriptTransportError: Si falla la comunicación HTTP.
        AppsScriptError: Si Apps Script rechaza el registro.
    """
    web_app_url, apps_script = _apps_script_config(config)
    if not web_app_url:
        return

    spreadsheet_id = (apps_script.get("spreadsheet_id") or "").strip()
    if not spreadsheet_id:
        sheet_url = (config.get("spreadsheet_url") or "").strip()
        if "/d/" in sheet_url:
            spreadsheet_id = sheet_url.split("/d/", 1)[1].split("/", 1)[0]

    network = build_network_summary(pc)
    payload = {
        "action": "save_technical",
        "token": apps_script.get("token", ""),
        "spreadsheet_id": spreadsheet_id,
        "sheet_name": apps_script.get("technical_sheet_name") or "TECNICA_EQUIPOS",
        "record_id": record_id,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "technical": {
            "id_equipo": record_id,
            "link_hoja_vida": html_link,
            "nombre_equipo": pc.get("hostname", "N/A"),
            "serial_bios": pc.get("serial_bios", "N/A"),
            "mac_principal": pc.get("mac_principal", "N/A"),
            "modelo_equipo": pc.get("modelo_equipo", "N/A"),
            "discos_particiones": build_disks_summary(pc),
            "red_tipo_conexion": network.get("tipo", "N/A"),
            "red_ipv4": network.get("ipv4", "N/A"),
            "red_velocidad": network.get("velocidad", "N/A"),
            "ram_resumen": build_ram_summary(pc),
            "os_name": pc.get("os_name", "N/A"),
            "os_version": pc.get("os_version", "N/A"),
            "last_boot": pc.get("last_boot", "N/A"),
            "cpu": pc.get("cpu", "N/A"),
            "ram_gb": pc.get("ram_gb", "N/A"),
        },
    }
    _post_json(web_app_url, payload)
