from __future__ import annotations

from datetime import datetime
from typing import List

from sqlalchemy import Integer, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ISAMInstance(Base):
    __tablename__ = "isam_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    host: Mapped[str] = mapped_column(String(100), nullable=False)
    telnet_port: Mapped[int] = mapped_column(Integer, nullable=False, default=23)
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    protocol_preference: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # 'telnet'|'ssh'|'auto'

    username: Mapped[str] = mapped_column(String(50), nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)

    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default="inactive"
    )  # 'active'|'inactive'|'error'
    health_protocol_used: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # ========== RELATIONSHIPS ==========
    data_cache: Mapped[List["ISAMData"]] = relationship(
        "ISAMData",
        back_populates="instance",
        cascade="all, delete-orphan",
    )

    # NEW: Port locks
    port_locks: Mapped[List["PortLock"]] = relationship(
        "PortLock",
        back_populates="instance",
        cascade="all, delete-orphan",
    )

    # NEW: LT Slots snapshots
    lt_slots: Mapped[List["ISAMLTSlot"]] = relationship(
        "ISAMLTSlot",
        back_populates="instance",
        cascade="all, delete-orphan",
    )

    # NEW: LT Ports snapshots
    lt_ports: Mapped[List["ISAMLTPort"]] = relationship(
        "ISAMLTPort",
        back_populates="instance",
        cascade="all, delete-orphan",
    )