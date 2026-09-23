"""Punto de entrada y orquestacion del inventario."""

from __future__ import annotations

import logging
import sys
import webbrowser
from pathlib import Path
from typing import Any

from .api_client import (
    AppsScriptError,
    AppsScriptTransportError,
    save_technical_record_with_apps_script,
    upload_html_with_apps_script,
)
from .collector import (
    build_disks_summary,
    build_network_summary,
    build_ram_summary,
    build_record_id,
    collect_pc_info,
)
from .config import build_prefill_url, get_runtime_base_dir, load_config
from .reporter import generate_html, resolve_html_link

LOGGER = logging.getLogger(__name__)


def configure_logging() -> None:
    """Configura el formato y nivel base del registro de ejecución."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def run() -> int:
    """Ejecuta el flujo completo de inventario y registro.

    Returns:
        int: Código de salida cero si el flujo termina correctamente, uno si
            ocurre un error de configuración, sistema o integración.
    """
    configure_logging()
    try:
        base_dir = get_runtime_base_dir()
        config = load_config(base_dir / "config.json")
        record_id = build_record_id()
        pc = collect_pc_info()
        html_path = generate_html(record_id, pc, Path(config["output_dir"]))

        uploaded_html_link = ""
        try:
            uploaded_html_link = upload_html_with_apps_script(record_id, html_path, config)
        except (AppsScriptTransportError, AppsScriptError) as exc:
            LOGGER.warning("No se pudo subir el HTML a Apps Script: %s", exc)

        html_link = uploaded_html_link or resolve_html_link(html_path, config)
        try:
            save_technical_record_with_apps_script(record_id, html_link, pc, config)
            LOGGER.info("Registro tecnico guardado en backend.")
        except (AppsScriptTransportError, AppsScriptError) as exc:
            LOGGER.warning("No se pudo guardar registro tecnico en backend: %s", exc)

        prefill_values: dict[str, Any] = {
            "id_equipo": record_id,
            "link_hoja_vida": html_link,
            "nombre_equipo": pc["hostname"],
            "serial_bios": pc["serial_bios"],
            "mac_principal": pc["mac_principal"],
            "modelo_equipo": pc["modelo_equipo"],
            "discos_particiones": build_disks_summary(pc),
            "ram_resumen": build_ram_summary(pc),
        }
        network = build_network_summary(pc)
        prefill_values.update(
            {
                "red_tipo_conexion": network["tipo"],
                "red_ipv4": network["ipv4"],
                "red_velocidad": network["velocidad"],
            }
        )
        if config.get("consent_option_value"):
            prefill_values["consent"] = config["consent_option_value"]

        prefill_url = build_prefill_url(
            config["form_view_url"],
            config["entry_ids"],
            prefill_values,
        )

        LOGGER.info("ID generado: %s", record_id)
        LOGGER.info("HTML generado: %s", html_path)
        if uploaded_html_link:
            LOGGER.info("HTML subido a Drive: %s", uploaded_html_link)
        LOGGER.info("Abriendo formulario para que el usuario complete sus datos")
        webbrowser.open(prefill_url, new=2)

        if config.get("open_html_after_generate", False):
            webbrowser.open(html_path.as_uri(), new=2)
        return 0
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        LOGGER.error("Error durante la ejecucion: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(run())
