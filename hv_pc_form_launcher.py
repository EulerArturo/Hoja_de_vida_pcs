import json
import random
import socket
import string
import subprocess
import sys
import webbrowser
import base64
import html
from datetime import datetime
from pathlib import Path
from urllib import request
from urllib.parse import urlencode


def get_runtime_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def load_config(config_path: Path) -> dict:
    if not config_path.exists():
        raise FileNotFoundError(
            f"No se encontro {config_path.name}. Crea el archivo usando config.example.json."
        )

    with config_path.open("r", encoding="utf-8") as f:
        config = json.load(f)

    required = ["form_view_url", "output_dir", "entry_ids"]
    for key in required:
        if key not in config:
            raise ValueError(f"Falta la clave obligatoria en config.json: {key}")

    entry_required = ["id_equipo"]
    for key in entry_required:
        if key not in config["entry_ids"]:
            raise ValueError(f"Falta entry_ids.{key} en config.json")

    return config


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


def run_ps(command: str) -> str:
    proc = subprocess.run(
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

    if proc.returncode != 0:
        return "N/A"

    value = (proc.stdout or "").strip()
    return value if value else "N/A"


def run_ps_json(command: str):
    raw = run_ps(command)
    if raw == "N/A":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def ensure_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def safe_html(value) -> str:
    if value is None:
        return "N/A"
    text = str(value).strip()
    if not text:
        return "N/A"
    return html.escape(text)


def format_gb(value) -> str:
    try:
        gb = float(value) / (1024 ** 3)
        return f"{gb:.2f}"
    except Exception:
        return "N/A"


def render_table(headers, rows):
    head = "".join(f"<th>{safe_html(h)}</th>" for h in headers)
    if not rows:
        return f"<table><tr>{head}</tr><tr><td colspan=\"{len(headers)}\">Sin datos disponibles</td></tr></table>"

    body_rows = []
    for row in rows:
        cols = "".join(f"<td>{safe_html(col)}</td>" for col in row)
        body_rows.append(f"<tr>{cols}</tr>")
    return f"<table><tr>{head}</tr>{''.join(body_rows)}</table>"


def build_disks_summary(pc: dict) -> str:
    volumes = ensure_list(pc.get("storage", {}).get("volumes"))
    if not volumes:
        return "N/A"

    chunks = []
    for vol in volumes:
        drive = f"{vol.get('DriveLetter', '')}:" if vol.get("DriveLetter") else "N/A"
        total_gb = format_gb(vol.get("Size", 0))
        free_gb = format_gb(vol.get("SizeRemaining", 0))
        fs = vol.get("FileSystem", "N/A")
        chunks.append(f"{drive} {total_gb}GB total / {free_gb}GB libre ({fs})")
    return " | ".join(chunks)


def build_network_summary(pc: dict) -> dict:
    adapters = ensure_list(pc.get("network", {}).get("adapters"))
    nics = ensure_list(pc.get("network", {}).get("nics"))

    connected = [a for a in adapters if str(a.get("Status", "")).lower() == "up"]
    primary = connected[0] if connected else (adapters[0] if adapters else {})

    desc = (primary.get("Description") or "").lower()
    name = (primary.get("Name") or "").lower()
    tipo = "Ethernet"
    if "wi-fi" in name or "wireless" in desc or "802.11" in desc or "wlan" in name:
        tipo = "Wi-Fi"

    ipv4 = "N/A"
    iface_name = primary.get("Name") or ""
    if nics:
        nic_match = next((n for n in nics if str(n.get("Interface", "")).lower() == str(iface_name).lower()), None)
        if nic_match:
            ipv4 = nic_match.get("IPv4", "N/A")
        else:
            ipv4 = nics[0].get("IPv4", "N/A")

    return {
        "tipo": tipo,
        "ipv4": ipv4 or "N/A",
        "velocidad": primary.get("LinkSpeed", "N/A") or "N/A",
    }


def build_ram_summary(pc: dict) -> str:
    slots = pc.get("memory_slots", {})
    total_slots = slots.get("totalSlots", "N/A")
    modules = ensure_list(slots.get("modules"))
    if not modules:
        return f"Ranuras totales: {total_slots} | Sin modulos detectados"

    total_capacity_bytes = 0
    speeds = []
    for mod in modules:
        try:
            total_capacity_bytes += int(mod.get("Capacity") or 0)
        except Exception:
            pass
        if mod.get("Speed"):
            speeds.append(str(mod.get("Speed")))

    capacity_gb = format_gb(total_capacity_bytes)
    speed_text = ", ".join(speeds) if speeds else "N/A"
    return f"Ranuras totales: {total_slots} | Capacidad: {capacity_gb}GB | Velocidad (MHz): {speed_text}"


def build_record_id() -> str:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"HV-{ts}-{suffix}"


def collect_pc_info() -> dict:
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
        """
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
    $ssidLine = $wifiRaw | Select-String '^\\s*SSID\\s*:\\s*(.+)$' | Select-Object -First 1
    $radioLine = $wifiRaw | Select-String '^\\s*Radio type\\s*:\\s*(.+)$' | Select-Object -First 1
    $channelLine = $wifiRaw | Select-String '^\\s*Channel\\s*:\\s*(.+)$' | Select-Object -First 1

    $ssid = if ($ssidLine) { $ssidLine.Matches[0].Groups[1].Value.Trim() } else { '' }
    $radio = if ($radioLine) { $radioLine.Matches[0].Groups[1].Value.Trim() } else { '' }
    $channel = if ($channelLine) { $channelLine.Matches[0].Groups[1].Value.Trim() } else { '' }

    $band = ''
    if ($channel -match '^\\d+$') {
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


def generate_html(record_id: str, pc: dict, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    html_path = output_dir / f"HV_PC_{record_id}.html"

    storage_physical_rows = []
    for disk in ensure_list(pc.get("storage", {}).get("physical")):
        storage_physical_rows.append([
            disk.get("FriendlyName", "N/A"),
            disk.get("MediaType", "N/A"),
            disk.get("BusType", "N/A"),
            format_gb(disk.get("Size")),
        ])

    volume_rows = []
    for vol in ensure_list(pc.get("storage", {}).get("volumes")):
        drive = f"{vol.get('DriveLetter', '')}:" if vol.get("DriveLetter") else "N/A"
        volume_rows.append([
            drive,
            vol.get("FileSystem", "N/A"),
            vol.get("Label", ""),
            format_gb(vol.get("Size", 0)),
            format_gb(vol.get("SizeRemaining", 0)),
            vol.get("HealthStatus", "N/A"),
        ])

    nic_rows = []
    for nic in ensure_list(pc.get("network", {}).get("nics")):
        nic_rows.append([
            nic.get("Interface", "N/A"),
            nic.get("IPv4", "N/A"),
            nic.get("IPv6", "N/A"),
            nic.get("Gateway", "N/A"),
            nic.get("DNS", "N/A"),
        ])

    adapter_rows = []
    for adapter in ensure_list(pc.get("network", {}).get("adapters")):
        adapter_rows.append([
            adapter.get("Name", "N/A"),
            adapter.get("Status", "N/A"),
            adapter.get("LinkSpeed", "N/A"),
            adapter.get("MacAddress", "N/A"),
            adapter.get("Description", "N/A"),
        ])

    gpu_rows = []
    for gpu in ensure_list(pc.get("gpu")):
        resolution = "N/A"
        if gpu.get("CurrentHorizontalResolution") and gpu.get("CurrentVerticalResolution"):
            resolution = f"{gpu.get('CurrentHorizontalResolution')}x{gpu.get('CurrentVerticalResolution')}"
        gpu_rows.append([
            gpu.get("Name", "N/A"),
            gpu.get("VideoProcessor", "N/A"),
            gpu.get("DriverVersion", "N/A"),
            format_gb(gpu.get("AdapterRAM", 0)),
            resolution,
            gpu.get("CurrentRefreshRate", "N/A"),
        ])

    modules_rows = []
    for mod in ensure_list(pc.get("memory_slots", {}).get("modules")):
        modules_rows.append([
            mod.get("DeviceLocator", "N/A"),
            format_gb(mod.get("Capacity", 0)),
            mod.get("Speed", "N/A"),
            mod.get("Manufacturer", "N/A"),
            mod.get("PartNumber", "N/A"),
        ])

    wifi = pc.get("network", {}).get("wifi") or {}

    html = f"""<html>
<head>
    <meta charset=\"utf-8\"> 
    <title>Informe de la PC</title>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
        h1 {{ color: #333366; }}
        h2 {{ color: #2e6da4; }}
        h3 {{ color: #2e6da4; margin-top: 12px; }}
        p {{ color: #555555; }}
        .info {{ margin: 20px 0; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }}
        th {{ background: #f2f2f2; }}
    </style>
</head>
<body>
    <h1>Informe Detallado de la PC</h1>

    <div class=\"info\">
        <h2>Control de Registro</h2>
        <p><strong>ID Equipo:</strong> {record_id}</p>
        <p><strong>Fecha de generacion:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    </div>

    <div class=\"info\">
        <h2>Sistema</h2>
        <p><strong>Nombre del equipo:</strong> {safe_html(pc['hostname'])}</p>
        <p><strong>Serial BIOS:</strong> {safe_html(pc['serial_bios'])}</p>
        <p><strong>Modelo:</strong> {safe_html(pc['modelo_equipo'])}</p>
        <p><strong>Fabricante:</strong> {safe_html(pc['fabricante'])}</p>
        <p><strong>Usuario:</strong> {safe_html(pc['usuario'])}</p>
        <p><strong>Dominio:</strong> {safe_html(pc['dominio'])}</p>
        <p><strong>MAC principal:</strong> {safe_html(pc['mac_principal'])}</p>
        <p><strong>CPU:</strong> {safe_html(pc['cpu'])}</p>
        <p><strong>RAM total (GB):</strong> {safe_html(pc['ram_gb'])}</p>
    </div>

    <div class=\"info\">
        <h2>Software y Sistema Operativo</h2>
        <p><strong>Sistema operativo:</strong> {safe_html(pc.get('os_name'))}</p>
        <p><strong>Version:</strong> {safe_html(pc.get('os_version'))}</p>
        <p><strong>Build:</strong> {safe_html(pc.get('os_build'))}</p>
        <p><strong>Ultima fecha de arranque:</strong> {safe_html(pc.get('last_boot'))}</p>
    </div>

    <div class=\"info\">
        <h2>Almacenamiento (Discos)</h2>
        <h3>Tipo de unidad</h3>
        {render_table(
            ["Unidad", "Tipo", "Tecnologia", "Tamano (GB)"],
            storage_physical_rows,
        )}
        <h3>Particiones y espacio</h3>
        {render_table(
            ["Unidad", "Sistema de archivos", "Etiqueta", "Tamano (GB)", "Libre (GB)", "Estado"],
            volume_rows,
        )}
    </div>

    <div class=\"info\">
        <h2>Detalles de Red</h2>
        <h3>IPv4 / IPv6 / Gateway / DNS</h3>
        {render_table(
            ["Interfaz", "IPv4", "IPv6", "Puerta de enlace", "DNS"],
            nic_rows,
        )}
        <h3>Estado de interfaz</h3>
        {render_table(
            ["Interfaz", "Estado", "Velocidad", "MAC", "Descripcion"],
            adapter_rows,
        )}
        <h3>Wi-Fi (banda)</h3>
        <p><strong>SSID:</strong> {safe_html(wifi.get('SSID'))}</p>
        <p><strong>Tipo de radio:</strong> {safe_html(wifi.get('Radio'))}</p>
        <p><strong>Canal:</strong> {safe_html(wifi.get('Channel'))}</p>
        <p><strong>Banda detectada:</strong> {safe_html(wifi.get('Band'))}</p>
    </div>

    <div class=\"info\">
        <h2>Graficos (GPU)</h2>
        {render_table(
            ["GPU", "Procesador de video", "Driver", "Memoria (GB)", "Resolucion actual", "Hz"],
            gpu_rows,
        )}
    </div>

    <div class=\"info\">
        <h2>Ranuras de RAM</h2>
        <p><strong>Ranuras totales:</strong> {safe_html(pc.get('memory_slots', {}).get('totalSlots'))}</p>
        <p><strong>Ranuras ocupadas:</strong> {safe_html(pc.get('memory_slots', {}).get('occupiedSlots'))}</p>
        <p><strong>Ranuras libres:</strong> {safe_html(pc.get('memory_slots', {}).get('freeSlots'))}</p>
        {render_table(
            ["Slot", "Capacidad (GB)", "Velocidad (MHz)", "Fabricante", "Part Number"],
            modules_rows,
        )}
    </div>
</body>
</html>
"""

    html_path.write_text(html, encoding="utf-8")
    return html_path


def resolve_html_link(html_path: Path, config: dict) -> str:
    base_url = (config.get("html_public_base_url") or "").strip()
    if not base_url:
        return str(html_path)

    return f"{base_url.rstrip('/')}/{html_path.name}"


def upload_html_with_apps_script(record_id: str, html_path: Path, config: dict) -> str:
    apps_script = config.get("apps_script") or {}
    web_app_url = (apps_script.get("web_app_url") or "").strip()
    if not web_app_url:
        return ""

    html_bytes = html_path.read_bytes()
    payload = {
        "action": "upload_html",
        "token": apps_script.get("token", ""),
        "record_id": record_id,
        "file_name": html_path.name,
        "mime_type": "text/html",
        "content_base64": base64.b64encode(html_bytes).decode("ascii"),
        "folder_id": (apps_script.get("folder_id") or "").strip(),
    }

    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        web_app_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    data = json.loads(raw)
    if not data.get("ok"):
        raise RuntimeError(f"Apps Script respondio error: {data}")

    return (data.get("renderUrl") or data.get("url") or "").strip()


def save_technical_record_with_apps_script(record_id: str, html_link: str, pc: dict, config: dict):
    apps_script = config.get("apps_script") or {}
    web_app_url = (apps_script.get("web_app_url") or "").strip()
    if not web_app_url:
        return

    spreadsheet_id = (apps_script.get("spreadsheet_id") or "").strip()
    if not spreadsheet_id:
        sheet_url = (config.get("spreadsheet_url") or "").strip()
        if "/d/" in sheet_url:
            spreadsheet_id = sheet_url.split("/d/")[1].split("/")[0]

    red = build_network_summary(pc)

    payload = {
        "action": "save_technical",
        "token": apps_script.get("token", ""),
        "spreadsheet_id": spreadsheet_id,
        "sheet_name": (apps_script.get("technical_sheet_name") or "TECNICA_EQUIPOS"),
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
            "red_tipo_conexion": red.get("tipo", "N/A"),
            "red_ipv4": red.get("ipv4", "N/A"),
            "red_velocidad": red.get("velocidad", "N/A"),
            "ram_resumen": build_ram_summary(pc),
            "os_name": pc.get("os_name", "N/A"),
            "os_version": pc.get("os_version", "N/A"),
            "last_boot": pc.get("last_boot", "N/A"),
            "cpu": pc.get("cpu", "N/A"),
            "ram_gb": pc.get("ram_gb", "N/A"),
        },
    }

    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        web_app_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    data = json.loads(raw)
    if not data.get("ok"):
        raise RuntimeError(f"No se pudo guardar registro tecnico en Sheet: {data}")


def build_prefill_url(form_view_url: str, entry_ids: dict, values: dict) -> str:
    params = {
        "usp": "pp_url",
        entry_ids["id_equipo"]: values["id_equipo"],
    }

    for key in OPTIONAL_ENTRY_KEYS:
        entry_id = entry_ids.get(key)
        value = values.get(key)
        if entry_id and value is not None and str(value).strip():
            params[entry_id] = str(value)

    return f"{form_view_url}?{urlencode(params)}"


def main() -> int:
    try:
        base_dir = get_runtime_base_dir()
        config = load_config(base_dir / "config.json")

        record_id = build_record_id()
        pc = collect_pc_info()

        html_path = generate_html(record_id, pc, Path(config["output_dir"]))
        uploaded_html_link = upload_html_with_apps_script(record_id, html_path, config)
        html_link = uploaded_html_link or resolve_html_link(html_path, config)

        try:
            save_technical_record_with_apps_script(record_id, html_link, pc, config)
            print("Registro tecnico guardado en backend.")
        except Exception as backend_exc:
            print("ADVERTENCIA: No se pudo guardar registro tecnico en backend:", backend_exc)

        prefill_values = {
            "id_equipo": record_id,
            "link_hoja_vida": html_link,
            "nombre_equipo": pc["hostname"],
            "serial_bios": pc["serial_bios"],
            "mac_principal": pc["mac_principal"],
            "modelo_equipo": pc["modelo_equipo"],
            "discos_particiones": build_disks_summary(pc),
            "ram_resumen": build_ram_summary(pc),
        }

        red_summary = build_network_summary(pc)
        prefill_values["red_tipo_conexion"] = red_summary["tipo"]
        prefill_values["red_ipv4"] = red_summary["ipv4"]
        prefill_values["red_velocidad"] = red_summary["velocidad"]

        prefill_url = build_prefill_url(
            config["form_view_url"],
            config["entry_ids"],
            prefill_values,
        )

        print("ID generado:", record_id)
        print("HTML generado:", html_path)
        if uploaded_html_link:
            print("HTML subido a Drive:", uploaded_html_link)
        print("Abriendo formulario para que el usuario complete solo sus datos...")

        webbrowser.open(prefill_url, new=2)

        if config.get("open_html_after_generate", False):
            webbrowser.open(html_path.as_uri(), new=2)

        return 0
    except Exception as exc:
        print("ERROR:", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
