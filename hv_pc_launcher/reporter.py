"""Generacion del informe HTML y resumenes presentables."""

from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path
from typing import Any

from .collector import ensure_list, format_gb


def safe_html(value: Any) -> str:
    """Escapa un valor para insertarlo como texto dentro del HTML.

    Args:
        value: Valor que se mostrará en el informe.

    Returns:
        str: Texto escapado o ``N/A`` para valores vacíos.
    """
    if value is None:
        return "N/A"
    text = str(value).strip()
    return html.escape(text) if text else "N/A"


def render_table(headers: list[Any], rows: list[list[Any]]) -> str:
    """Genera una tabla HTML con encabezados y filas sanitizados.

    Args:
        headers: Encabezados de las columnas.
        rows: Filas de datos que se mostrarán.

    Returns:
        str: Fragmento HTML de la tabla.
    """
    header_html = "".join(f"<th>{safe_html(header)}</th>" for header in headers)
    if not rows:
        return (
            f'<table><tr>{header_html}</tr>'
            f'<tr><td colspan="{len(headers)}">Sin datos disponibles</td></tr></table>'
        )

    body = "".join(
        f"<tr>{''.join(f'<td>{safe_html(column)}</td>' for column in row)}</tr>"
        for row in rows
    )
    return f"<table><tr>{header_html}</tr>{body}</table>"


def generate_html(record_id: str, pc: dict[str, Any], output_dir: Path) -> Path:
    """Genera y guarda el informe HTML detallado de un equipo.

    Args:
        record_id: Identificador de la hoja de vida.
        pc: Inventario técnico recolectado.
        output_dir: Directorio donde se escribirá el archivo.

    Returns:
        Path: Ruta del informe HTML creado.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    html_path = output_dir / f"HV_PC_{record_id}.html"

    physical_rows = [
        [
            disk.get("FriendlyName", "N/A"),
            disk.get("MediaType", "N/A"),
            disk.get("BusType", "N/A"),
            format_gb(disk.get("Size")),
        ]
        for disk in ensure_list(pc.get("storage", {}).get("physical"))
    ]
    volume_rows = [
        [
            f"{volume.get('DriveLetter', '')}:" if volume.get("DriveLetter") else "N/A",
            volume.get("FileSystem", "N/A"),
            volume.get("Label", ""),
            format_gb(volume.get("Size", 0)),
            format_gb(volume.get("SizeRemaining", 0)),
            volume.get("HealthStatus", "N/A"),
        ]
        for volume in ensure_list(pc.get("storage", {}).get("volumes"))
    ]
    nic_rows = [
        [
            nic.get("Interface", "N/A"),
            nic.get("IPv4", "N/A"),
            nic.get("IPv6", "N/A"),
            nic.get("Gateway", "N/A"),
            nic.get("DNS", "N/A"),
        ]
        for nic in ensure_list(pc.get("network", {}).get("nics"))
    ]
    adapter_rows = [
        [
            adapter.get("Name", "N/A"),
            adapter.get("Status", "N/A"),
            adapter.get("LinkSpeed", "N/A"),
            adapter.get("MacAddress", "N/A"),
            adapter.get("Description", "N/A"),
        ]
        for adapter in ensure_list(pc.get("network", {}).get("adapters"))
    ]
    gpu_rows = []
    for gpu in ensure_list(pc.get("gpu")):
        resolution = "N/A"
        if gpu.get("CurrentHorizontalResolution") and gpu.get("CurrentVerticalResolution"):
            resolution = f"{gpu['CurrentHorizontalResolution']}x{gpu['CurrentVerticalResolution']}"
        gpu_rows.append([
            gpu.get("Name", "N/A"),
            gpu.get("VideoProcessor", "N/A"),
            gpu.get("DriverVersion", "N/A"),
            format_gb(gpu.get("AdapterRAM", 0)),
            resolution,
            gpu.get("CurrentRefreshRate", "N/A"),
        ])
    modules_rows = [
        [
            module.get("DeviceLocator", "N/A"),
            format_gb(module.get("Capacity", 0)),
            module.get("Speed", "N/A"),
            module.get("Manufacturer", "N/A"),
            module.get("PartNumber", "N/A"),
        ]
        for module in ensure_list(pc.get("memory_slots", {}).get("modules"))
    ]
    wifi = pc.get("network", {}).get("wifi") or {}

    document = f"""<html>
<head>
    <meta charset="utf-8">
    <title>Informe de la PC</title>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
        h1 {{ color: #333366; }} h2, h3 {{ color: #2e6da4; }}
        h3 {{ margin-top: 12px; }} p {{ color: #555555; }}
        .info {{ margin: 20px 0; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }}
        th {{ background: #f2f2f2; }}
    </style>
</head>
<body>
    <h1>Informe Detallado de la PC</h1>
    <div class="info">
        <h2>Control de Registro</h2>
        <p><strong>ID Equipo:</strong> {safe_html(record_id)}</p>
        <p><strong>Fecha de generacion:</strong> {safe_html(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))}</p>
    </div>
    <div class="info">
        <h2>Sistema</h2>
        <p><strong>Nombre del equipo:</strong> {safe_html(pc.get('hostname'))}</p>
        <p><strong>Serial BIOS:</strong> {safe_html(pc.get('serial_bios'))}</p>
        <p><strong>Modelo:</strong> {safe_html(pc.get('modelo_equipo'))}</p>
        <p><strong>Fabricante:</strong> {safe_html(pc.get('fabricante'))}</p>
        <p><strong>Usuario:</strong> {safe_html(pc.get('usuario'))}</p>
        <p><strong>Dominio:</strong> {safe_html(pc.get('dominio'))}</p>
        <p><strong>MAC principal:</strong> {safe_html(pc.get('mac_principal'))}</p>
        <p><strong>CPU:</strong> {safe_html(pc.get('cpu'))}</p>
        <p><strong>RAM total (GB):</strong> {safe_html(pc.get('ram_gb'))}</p>
    </div>
    <div class="info">
        <h2>Software y Sistema Operativo</h2>
        <p><strong>Sistema operativo:</strong> {safe_html(pc.get('os_name'))}</p>
        <p><strong>Version:</strong> {safe_html(pc.get('os_version'))}</p>
        <p><strong>Build:</strong> {safe_html(pc.get('os_build'))}</p>
        <p><strong>Ultima fecha de arranque:</strong> {safe_html(pc.get('last_boot'))}</p>
    </div>
    <div class="info">
        <h2>Almacenamiento (Discos)</h2>
        <h3>Tipo de unidad</h3>
        {render_table(['Unidad', 'Tipo', 'Tecnologia', 'Tamano (GB)'], physical_rows)}
        <h3>Particiones y espacio</h3>
        {render_table(['Unidad', 'Sistema de archivos', 'Etiqueta', 'Tamano (GB)', 'Libre (GB)', 'Estado'], volume_rows)}
    </div>
    <div class="info">
        <h2>Detalles de Red</h2>
        <h3>IPv4 / IPv6 / Gateway / DNS</h3>
        {render_table(['Interfaz', 'IPv4', 'IPv6', 'Puerta de enlace', 'DNS'], nic_rows)}
        <h3>Estado de interfaz</h3>
        {render_table(['Interfaz', 'Estado', 'Velocidad', 'MAC', 'Descripcion'], adapter_rows)}
        <h3>Wi-Fi (banda)</h3>
        <p><strong>SSID:</strong> {safe_html(wifi.get('SSID'))}</p>
        <p><strong>Tipo de radio:</strong> {safe_html(wifi.get('Radio'))}</p>
        <p><strong>Canal:</strong> {safe_html(wifi.get('Channel'))}</p>
        <p><strong>Banda detectada:</strong> {safe_html(wifi.get('Band'))}</p>
    </div>
    <div class="info">
        <h2>Graficos (GPU)</h2>
        {render_table(['GPU', 'Procesador de video', 'Driver', 'Memoria (GB)', 'Resolucion actual', 'Hz'], gpu_rows)}
    </div>
    <div class="info">
        <h2>Ranuras de RAM</h2>
        <p><strong>Ranuras totales:</strong> {safe_html(pc.get('memory_slots', {}).get('totalSlots'))}</p>
        <p><strong>Ranuras ocupadas:</strong> {safe_html(pc.get('memory_slots', {}).get('occupiedSlots'))}</p>
        <p><strong>Ranuras libres:</strong> {safe_html(pc.get('memory_slots', {}).get('freeSlots'))}</p>
        {render_table(['Slot', 'Capacidad (GB)', 'Velocidad (MHz)', 'Fabricante', 'Part Number'], modules_rows)}
    </div>
</body>
</html>
"""

    html_path.write_text(document, encoding="utf-8")
    return html_path


def resolve_html_link(html_path: Path, config: dict[str, Any]) -> str:
    """Resuelve el enlace público o local del informe generado.

    Args:
        html_path: Ruta local del informe.
        config: Configuración del cliente.

    Returns:
        str: URL pública configurada o ruta local del archivo.
    """
    base_url = (config.get("html_public_base_url") or "").strip()
    if not base_url:
        return str(html_path)
    return f"{base_url.rstrip('/')}/{html_path.name}"
