"""Carga, validacion y utilidades de configuracion."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

OPTIONAL_ENTRY_KEYS = [
    "link_hoja_vida",
    "nombre_equipo",
    "serial_bios",
    "mac_principal",
    "modelo_equipo",
    "discos_particiones",
    "red_tipo_conexion",
    "red_ipv4",
    "red_velocidad",
    "ram_resumen",
]


def get_runtime_base_dir() -> Path:
    """Obtiene la carpeta base utilizada para localizar la configuración.

    Returns:
        Path: Carpeta del ejecutable empaquetado o raíz del proyecto en modo fuente.
    """
    import sys

    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def load_config(config_path: Path) -> dict[str, Any]:
    """Carga y valida la configuración JSON del cliente.

    Args:
        config_path: Ruta al archivo de configuración local.

    Returns:
        dict[str, Any]: Configuración validada.

    Raises:
        FileNotFoundError: Si la ruta no existe.
        ValueError: Si el JSON o las claves obligatorias son inválidos.
    """
    if not config_path.exists():
        raise FileNotFoundError(
            f"No se encontro {config_path.name}. Crea el archivo usando config.example.json."
        )

    try:
        with config_path.open("r", encoding="utf-8") as config_file:
            config = json.load(config_file)
    except json.JSONDecodeError as exc:
        raise ValueError(f"config.json no contiene JSON valido: {exc}") from exc

    if not isinstance(config, dict):
        raise ValueError("config.json debe contener un objeto JSON en la raiz")

    for key in ("form_view_url", "output_dir", "entry_ids"):
        if key not in config:
            message = f"Falta la clave obligatoria en config.json: {key}"
            raise ValueError(message)

    entry_ids = config["entry_ids"]
    if not isinstance(entry_ids, dict):
        raise ValueError("entry_ids debe ser un objeto JSON")
    if not (entry_ids.get("serial_bios") or entry_ids.get("id_equipo")):
        message = "Falta entry_ids.serial_bios o entry_ids.id_equipo en config.json"
        raise ValueError(message)

    return config


def build_prefill_url(form_view_url: str, entry_ids: dict[str, str], values: dict[str, Any]) -> str:
    """Construye una URL de Google Forms con campos prellenados.

    Args:
        form_view_url: URL pública del formulario.
        entry_ids: Mapa de nombres lógicos a identificadores ``entry.*``.
        values: Valores técnicos y administrativos disponibles.

    Returns:
        str: URL con los parámetros codificados.
    """
    from urllib.parse import urlencode

    params: dict[str, str] = {"usp": "pp_url"}

    if entry_ids.get("serial_bios") and values.get("serial_bios"):
        params[entry_ids["serial_bios"]] = str(values["serial_bios"])
    elif entry_ids.get("id_equipo") and values.get("id_equipo"):
        params[entry_ids["id_equipo"]] = str(values["id_equipo"])

    if entry_ids.get("id_equipo") and values.get("id_equipo"):
        params[entry_ids["id_equipo"]] = str(values["id_equipo"])

    for key in OPTIONAL_ENTRY_KEYS:
        entry_id = entry_ids.get(key)
        value = values.get(key)
        if entry_id and value is not None and str(value).strip():
            params[entry_id] = str(value)

    if entry_ids.get("consent") and values.get("consent"):
        params[entry_ids["consent"]] = str(values["consent"])

    separator = "&" if "?" in form_view_url else "?"
    return f"{form_view_url}{separator}{urlencode(params)}"
