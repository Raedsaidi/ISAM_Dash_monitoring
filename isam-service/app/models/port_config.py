from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class PortConfigStatus(str, PyEnum):
    UNKNOWN = "UNKNOWN"
    NOT_CONFIGURED = "NOT_CONFIGURED"   # aucune ligne vlan-id/vlan-scope
    VIA_APP = "VIA_APP"                 # device == expected (appliqué via app)
    MANUAL = "MANUAL"                   # device a des VLAN mais expected absent
    DRIFTED = "DRIFTED"                 # expected existe mais device != expected


class PortConfig(Base):
    __tablename__ = "ports_config"
    __table_args__ = (
        UniqueConstraint("isam_instance_id", "port_id", name="uq_ports_config_instance_port"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    isam_instance_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("isam_instances.id", ondelete="CASCADE"), nullable=False
    )

    # port court: ex "1/1/7/3/95"
    port_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # dernier apply via app
    last_template_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("wan_templates.id", ondelete="SET NULL"), nullable=True
    )
    last_applied_by: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    apply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # attendu (depuis template exécuté par app)
    expected_vlan_lines: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    expected_vlan_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # réel (device)
    device_vlan_lines: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    device_vlan_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_raw_output: Mapped[str | None] = mapped_column(Text, nullable=True)

    last_device_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_device_check_success: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0/1
    last_device_check_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=PortConfigStatus.UNKNOWN.value
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    instance = relationship("ISAMInstance")
    template = relationship("WanTemplate")

    ont_sernum: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ont_raw_output: Mapped[str | None] = mapped_column(Text, nullable=True)  # ou LONGTEXT si tu veux
    ont_last_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ont_last_check_success: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0/1
    ont_last_check_error: Mapped[str | None] = mapped_column(Text, nullable=True)