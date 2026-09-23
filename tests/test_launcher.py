"""Pruebas unitarias de las funciones puras del cliente modular."""

import unittest
from urllib.parse import parse_qs, urlparse

from hv_pc_launcher.collector import (
    build_network_summary,
    build_ram_summary,
    build_record_id,
)
from hv_pc_launcher.config import build_prefill_url


class BuildRecordIdTests(unittest.TestCase):
    """Verifica la generación y unicidad práctica de identificadores."""

    def test_generates_expected_format(self):
        """Comprueba el formato contractual del identificador."""
        record_id = build_record_id()

        self.assertRegex(record_id, r"^HV-\d{8}-\d{6}-[A-Z0-9]{6}$")

    def test_generates_distinct_ids_in_normal_use(self):
        """Comprueba que una serie normal no repita identificadores."""
        record_ids = {build_record_id() for _ in range(20)}

        self.assertEqual(len(record_ids), 20)


class BuildNetworkSummaryTests(unittest.TestCase):
    """Verifica la selección de interfaz y resumen de conectividad."""

    def test_prefers_connected_adapter_and_matching_nic(self):
        """Prefiere el adaptador activo y su interfaz de red asociada."""
        pc = {
            "network": {
                "adapters": [
                    {
                        "Name": "Ethernet",
                        "Status": "Down",
                        "LinkSpeed": "100 Mbps",
                        "Description": "Ethernet adapter",
                    },
                    {
                        "Name": "Wi-Fi",
                        "Status": "Up",
                        "LinkSpeed": "866 Mbps",
                        "Description": "Wireless 802.11ax adapter",
                    },
                ],
                "nics": [
                    {"Interface": "Wi-Fi", "IPv4": "192.168.1.20"},
                ],
            }
        }

        result = build_network_summary(pc)

        self.assertEqual(
            result,
            {
                "tipo": "Wi-Fi",
                "ipv4": "192.168.1.20",
                "velocidad": "866 Mbps",
            },
        )

    def test_returns_defaults_without_network_data(self):
        """Devuelve valores operativos cuando no hay datos de red."""
        result = build_network_summary({})

        self.assertEqual(result, {
            "tipo": "Ethernet",
            "ipv4": "N/A",
            "velocidad": "N/A",
        })


class BuildRamSummaryTests(unittest.TestCase):
    """Verifica el cálculo del resumen de memoria instalada."""

    def test_summarizes_slots_capacity_and_speed(self):
        """Calcula ranuras, capacidad total y velocidades de módulos."""
        pc = {
            "memory_slots": {
                "totalSlots": 4,
                "modules": [
                    {"Capacity": 8 * 1024**3, "Speed": 3200},
                    {"Capacity": 16 * 1024**3, "Speed": 3200},
                ],
            }
        }

        result = build_ram_summary(pc)

        self.assertEqual(
            result,
            "Ranuras totales: 4 | Capacidad: 24.00GB | Velocidad (MHz): 3200, 3200",
        )

    def test_reports_empty_slots_when_modules_are_missing(self):
        """Informa la ausencia de módulos sin producir una excepción."""
        result = build_ram_summary({"memory_slots": {"totalSlots": 2, "modules": []}})

        self.assertEqual(result, "Ranuras totales: 2 | Sin modulos detectados")


class BuildPrefillUrlTests(unittest.TestCase):
    """Verifica la construcción segura de URLs de Google Forms."""

    def test_includes_primary_and_optional_values_encoded(self):
        """Incluye valores primarios y opcionales correctamente codificados."""
        entry_ids = {
            "id_equipo": "entry.100",
            "serial_bios": "entry.200",
            "consent": "entry.300",
            "ram_resumen": "entry.400",
        }
        values = {
            "id_equipo": "HV-20260923-120000-ABC123",
            "serial_bios": "BIOS 123/ABC",
            "consent": "Acepto & autorizo",
            "ram_resumen": "16 GB",
        }

        result = build_prefill_url("https://forms.google.test/viewform", entry_ids, values)
        query = parse_qs(urlparse(result).query)

        self.assertEqual(query["usp"], ["pp_url"])
        self.assertEqual(query["entry.100"], [values["id_equipo"]])
        self.assertEqual(query["entry.200"], [values["serial_bios"]])
        self.assertEqual(query["entry.300"], [values["consent"]])
        self.assertEqual(query["entry.400"], [values["ram_resumen"]])

    def test_preserves_existing_query_parameters(self):
        """Conserva parámetros existentes al añadir el prellenado."""
        result = build_prefill_url(
            "https://forms.google.test/viewform?source=inventory",
            {"id_equipo": "entry.100"},
            {"id_equipo": "HV-20260923-120000-ABC123"},
        )

        self.assertIn("source=inventory", result)
        self.assertIn("entry.100=HV-20260923-120000-ABC123", result)


if __name__ == "__main__":
    unittest.main()
