
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple, Union


def natural_sort_key(value: str) -> Tuple[Union[int, str], ...]:
    """
    Génère une clé de tri naturel.
    """
    parts: list[Union[int, str]] = []

    for segment in re.split(r"([0-9]+)", value):
        if segment.isdigit():
            parts.append(int(segment))
        elif segment:
            parts.append(segment.lower())

    return tuple(parts)


def sort_slots(slots: List[Dict[str, Any]], key_field: str = "slot_id") -> List[Dict[str, Any]]:
    """
    Trie une liste de dicts de slots par leur identifiant (tri naturel).
    """
    return sorted(
        slots,
        key=lambda s: natural_sort_key(s.get(key_field, "")),
    )


def sort_ports(
    ports: List[Dict[str, Any]],
    key_fields: Tuple[str, ...] = ("port_type", "port_id"),
) -> List[Dict[str, Any]]:
    """
    Trie une liste de dicts de ports par type puis par identifiant (tri naturel).
    """
    return sorted(
        ports,
        key=lambda p: tuple(
            natural_sort_key(p.get(field, "")) for field in key_fields
        ),
    )


def sort_slots_with_ports(
    slots: List[Dict[str, Any]],
    slot_key: str = "slot_id",
    ports_key: str = "ports",
    port_sort_fields: Tuple[str, ...] = ("port_type", "port_id"),
) -> List[Dict[str, Any]]:
    """
    Trie les slots ET les ports à l'intérieur de chaque slot.
    """
    sorted_slots = sort_slots(slots, key_field=slot_key)

    result: List[Dict[str, Any]] = []
    for slot in sorted_slots:
        slot_copy = dict(slot)
        inner_ports = slot_copy.get(ports_key, [])
        if inner_ports:
            slot_copy[ports_key] = sort_ports(inner_ports, key_fields=port_sort_fields)
        result.append(slot_copy)

    return result