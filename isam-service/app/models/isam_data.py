from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Integer, String, DateTime, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ISAMDataType(str, PyEnum):
    PORTS = "ports"
    MEMORY_USAGE = "memory_usage"
    LT_SLOTS = "lt_slots"  # NEW
    LT_PORTS = "lt_ports"  # NEW


class ISAMData(Base):
    __tablename__ = "isam_data"
    __table_args__ = (
        UniqueConstraint("isam_instance_id", "data_type", name="uq_isam_data_instance_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    isam_instance_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=False,
    )

    # "ports" | "memory_usage" | "lt_slots" | "lt_ports"
    data_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # Dernier snapshot VALIDE
    raw_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    protocol_used: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Métadonnées du dernier refresh
    last_refresh_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_refresh_success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_refresh_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Date du dernier snapshot réussi
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    instance = relationship("ISAMInstance", back_populates="data_cache")