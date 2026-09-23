"""Recoleccion de inventario Windows mediante PowerShell."""

from __future__ import annotations

import json
import random
import socket
import string
import subprocess
from datetime import datetime
from typing import Any


def run_ps(command: str) -> str:
    """Ejecuta una consulta PowerShell de forma no interactiva.

    Args:
        command: Expresión o script PowerShell que se ejecutará.

    Returns:
        str: Salida limpia del comando o ``N/A`` si falla.
    """
    process = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode != 0:
        return "N/A"
    value = (process.stdout or "").strip()
    return value if value else "N/A"


def run_ps_json(command: str) -> Any:
    """Ejecuta PowerShell y convierte su salida JSON.

    Args:
        command: Script PowerShell que debe producir JSON.

    Returns:
        Any: Objeto deserializado o ``None`` si la consulta no es válida.
    """
    raw = run_ps(command)
    if raw == "N/A":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def ensure_list(value: Any) -> list[Any]:
    """Normaliza un valor opcional a una lista.

    Args:
        value: Valor individual, lista o ``None``.

    Returns:
        list[Any]: Lista vacía, la lista original o una lista de un elemento.
    """
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def format_gb(value: Any) -> str:
    """Convierte bytes a gigabytes con dos decimales.

    Args:
        value: Número de bytes convertible a ``float``.

    Returns:
        str: Capacidad formateada o ``N/A`` si no es numérica.
    """
    try:
        return f"{float(value) / (1024 ** 3):.2f}"
    except (TypeError, ValueError):
        return "N/A"


def build_disks_summary(pc: dict[str, Any]) -> str:
    """Resume volúmenes y espacio disponible del equipo.

    Args:
        pc: Inventario técnico recolectado.

    Returns:
        str: Resumen compacto de discos y volúmenes.
    """
    volumes = ensure_list(pc.get("storage", {}).get("volumes"))
    if not volumes:
        return "N/A"

    chunks = []
    for volume in volumes:
        drive = f"{volume.get('DriveLetter', '')}:" if volume.get("DriveLetter") else "N/A"
        total_gb = format_gb(volume.get("Size", 0))
        free_gb = format_gb(volume.get("SizeRemaining", 0))
        filesystem = volume.get("FileSystem", "N/A")
        chunks.append(f"{drive} {total_gb}GB total / {free_gb}GB libre ({filesystem})")
    return " | ".join(chunks)


def build_network_summary(pc: dict[str, Any]) -> dict[str, str]:
    """Determina la interfaz principal, tipo de conexión, IPv4 y velocidad.

    Args:
        pc: Inventario técnico recolectado.

    Returns:
        dict[str, str]: Resumen con las claves ``tipo``, ``ipv4`` y ``velocidad``.
    """
    adapters = ensure_list(pc.get("network", {}).get("adapters"))
    nics = ensure_list(pc.get("network", {}).get("nics"))
    connected = [adapter for adapter in adapters if str(adapter.get("Status", "")).lower() == "up"]
    primary = connected[0] if connected else (adapters[0] if adapters else {})

    description = (primary.get("Description") or "").lower()
    name = (primary.get("Name") or "").lower()
    connection_type = "Ethernet"
    if "wi-fi" in name or "wireless" in description or "802.11" in description or "wlan" in name:
        connection_type = "Wi-Fi"

    ipv4 = "N/A"
    interface_name = primary.get("Name") or ""
    if nics:
        nic_match = next(
            (nic for nic in nics if str(nic.get("Interface", "")).lower() == str(interface_name).lower()),
            None,
        )
        ipv4 = (nic_match or nics[0]).get("IPv4", "N/A")

    return {
        "tipo": connection_type,
        "ipv4": ipv4 or "N/A",
        "velocidad": primary.get("LinkSpeed", "N/A") or "N/A",
    }


def build_ram_summary(pc: dict[str, Any]) -> str:
    """Resume ranuras, capacidad instalada y velocidades de memoria.

    Args:
        pc: Inventario técnico recolectado.

    Returns:
        str: Resumen de memoria RAM para el formulario y el informe.
    """
    slots = pc.get("memory_slots", {})
    total_slots = slots.get("totalSlots", "N/A")
    modules = ensure_list(slots.get("modules"))
    if not modules:
        return f"Ranuras totales: {total_slots} | Sin modulos detectados"

    total_capacity = 0
    speeds = []
    for module in modules:
        try:
            total_capacity += int(module.get("Capacity") or 0)
        except (TypeError, ValueError):
            continue
        if module.get("Speed"):
            speeds.append(str(module["Speed"]))

    speed_text = ", ".join(speeds) if speeds else "N/A"
    return (
        f"Ranuras totales: {total_slots} | Capacidad: {format_gb(total_capacity)}GB | "
        f"Velocidad (MHz): {speed_text}"
    )


def build_record_id() -> str:
    """Genera el identificador operativo de una hoja de vida.

    Returns:
        str: Identificador con formato ``HV-YYYYMMDD-HHMMSS-XXXXXX``.
    """
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"HV-{timestamp}-{suffix}"


def collect_pc_info() -> dict[str, Any]:
    """Recolecta hardware, sistema operativo y red desde Windows.

    Returns:
        dict[str, Any]: Inventario técnico normalizado para los demás módulos.
    """
    hostname = socket.gethostname()
    serial_bios = run_ps("(Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber)")
    model = run_ps("(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model)")
    manufacturer = run_ps("(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Manufacturer)")
    username = run_ps("(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty UserName)")
    domain = run_ps("(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Domain)")
    cpu = run_ps("(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name)")
    ram_gb = run_ps("[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)")

    mac_principal = run_ps(
        """
$adapter = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.MacAddress } | Select-Object -First 1
if (-not $adapter) {
    $adapter = Get-NetAdapter -Physical | Where-Object { $_.MacAddress } | Select-Object -First 1
}
if ($adapter) { $adapter.MacAddress } else { 'N/A' }
"""
    )
    os_name = run_ps("(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)")
    os_version = run_ps("(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Version)")
    os_build = run_ps("(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty BuildNumber)")
    last_boot = run_ps(
        """
$os = Get-CimInstance Win32_OperatingSystem
if ($os -and $os.LastBootUpTime) {
    ([Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)).ToString('yyyy-MM-dd HH:mm:ss')
} else {
    'N/A'
}
"""
    )

    storage_data = run_ps_json(
        """
$obj = [ordered]@{
    physical = @(
        Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
            [ordered]@{
                FriendlyName = $_.FriendlyName
                MediaType = $_.MediaType
                BusType = $_.BusType
                Size = $_.Size
            }
        }
    )
    volumes = @(
        Get-Volume -ErrorAction SilentlyContinue |
            Where-Object { $_.DriveLetter -ne $null } |
            ForEach-Object {
                [ordered]@{
                    DriveLetter = $_.DriveLetter
                    FileSystem = $_.FileSystem
                    Size = $_.Size
                    SizeRemaining = $_.SizeRemaining
                    HealthStatus = $_.HealthStatus
                    Label = $_.FileSystemLabel
                }
            }
    )
}
$obj | ConvertTo-Json -Depth 6
"""
    ) or {}

    network_data = run_ps_json(
        r"""
$nics = @(
    Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.NetAdapter.Status -eq 'Up' } |
        ForEach-Object {
            [ordered]@{
                Interface = $_.InterfaceAlias
                InterfaceDescription = $_.InterfaceDescription
                IPv4 = (($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ', ')
                IPv6 = (($_.IPv6Address | ForEach-Object { $_.IPAddress }) -join ', ')
                Gateway = (($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', ')
                DNS = (($_.DNSServer.ServerAddresses) -join ', ')
            }
        }
)

$adapters = @(
    Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
        ForEach-Object {
            [ordered]@{
                Name = $_.Name
                Status = $_.Status
                LinkSpeed = $_.LinkSpeed
                MacAddress = $_.MacAddress
                Description = $_.InterfaceDescription
            }
        }
)

$wifi = @{}
$wifiRaw = netsh wlan show interfaces 2>$null
if ($wifiRaw) {
    $ssidLine = $wifiRaw | Select-String '^\s*SSID\s*:\s*(.+)$' | Select-Object -First 1
    $radioLine = $wifiRaw | Select-String '^\s*Radio type\s*:\s*(.+)$' | Select-Object -First 1
    $channelLine = $wifiRaw | Select-String '^\s*Channel\s*:\s*(.+)$' | Select-Object -First 1

    $ssid = if ($ssidLine) { $ssidLine.Matches[0].Groups[1].Value.Trim() } else { '' }
    $radio = if ($radioLine) { $radioLine.Matches[0].Groups[1].Value.Trim() } else { '' }
    $channel = if ($channelLine) { $channelLine.Matches[0].Groups[1].Value.Trim() } else { '' }

    $band = ''
    if ($channel -match '^\d+$') {
        $ch = [int]$channel
        if ($ch -le 14) { $band = '2.4 GHz' } else { $band = '5 GHz' }
    }

    $wifi = [ordered]@{
        SSID = $ssid
        Radio = $radio
        Channel = $channel
        Band = $band
    }
}

[ordered]@{
    nics = $nics
    adapters = $adapters
    wifi = $wifi
} | ConvertTo-Json -Depth 6
"""
    ) or {}

    gpu_data = ensure_list(
        run_ps_json(
            """
Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
    ForEach-Object {
        [ordered]@{
            Name = $_.Name
            VideoProcessor = $_.VideoProcessor
            DriverVersion = $_.DriverVersion
            AdapterRAM = $_.AdapterRAM
            CurrentHorizontalResolution = $_.CurrentHorizontalResolution
            CurrentVerticalResolution = $_.CurrentVerticalResolution
            CurrentRefreshRate = $_.CurrentRefreshRate
        }
    } | ConvertTo-Json -Depth 4
"""
        )
    )

    memory_slots = run_ps_json(
        """
$modules = @(Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue)
$array = Get-CimInstance Win32_PhysicalMemoryArray -ErrorAction SilentlyContinue | Select-Object -First 1
$totalSlots = if ($array) { $array.MemoryDevices } else { $null }
$occupied = $modules.Count
$free = if ($totalSlots -ne $null) { $totalSlots - $occupied } else { $null }

[ordered]@{
    totalSlots = $totalSlots
    occupiedSlots = $occupied
    freeSlots = $free
    modules = @(
        $modules | ForEach-Object {
            [ordered]@{
                DeviceLocator = $_.DeviceLocator
                Capacity = $_.Capacity
                Speed = $_.Speed
                Manufacturer = $_.Manufacturer
                PartNumber = $_.PartNumber
            }
        }
    )
} | ConvertTo-Json -Depth 6
"""
    ) or {}

    return {
        "hostname": hostname,
        "serial_bios": serial_bios,
        "modelo_equipo": model,
        "fabricante": manufacturer,
        "usuario": username,
        "dominio": domain,
        "cpu": cpu,
        "ram_gb": ram_gb,
        "mac_principal": mac_principal,
        "os_name": os_name,
        "os_version": os_version,
        "os_build": os_build,
        "last_boot": last_boot,
        "storage": storage_data,
        "network": network_data,
        "gpu": gpu_data,
        "memory_slots": memory_slots,
    }
