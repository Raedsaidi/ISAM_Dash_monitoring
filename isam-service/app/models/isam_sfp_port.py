# app/models/isam_sfp_port.py
from __future__ import annotations

from datetime import datetime
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy import Integer, String, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ISAMSFPPort(Base):
    """
    Snapshot SFP transceiver par port.

    Chaque ligne = un SFP physique identifié par :
        instance + slot_short_id + sfp_index
    
    Le port_id logique (ex: 1/1/6/35) est déduit :
        port_id = slot_short_id + "/" + sfp_index
    """
    __tablename__ = "isam_sfp_ports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    isam_instance_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ex: "1/1/6"
    slot_short_id: Mapped[str] = mapped_column(String(30), nullable=False)

    # ex: "lt:1/1/6"
    slot_id: Mapped[str] = mapped_column(String(40), nullable=False)

    # ex: 35
    sfp_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # ex: "lt:1/1/6:sfp:35"
    sfp_id: Mapped[str] = mapped_column(String(60), nullable=False)

    # ex: "1/1/6/35"  (slot_short_id + "/" + sfp_index)
    port_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    # no-error | cage-empty | sfp-no-a2-supp
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="unknown")

    is_empty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_copper: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ex: "3FE66131AA"
    part_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ex: "1490.00 nm"
    wavelength: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # ex: "single-mode"
    fiber_mode: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # ex: "1000base_bx10d"
    standard: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # ex: "1 Gbps"
    speed: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # upstream | downstream | bidirectional
    direction: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # fiber | copper
    media: Mapped[str | None] = mapped_column(String(15), nullable=True)

    # ex: "1490nm"
    tx_wavelength: Mapped[str | None] = mapped_column(String(15), nullable=True)
    rx_wavelength: Mapped[str | None] = mapped_column(String(15), nullable=True)

    last_refresh_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    instance = relationship("ISAMInstance")

    __table_args__ = (
        UniqueConstraint(
            "isam_instance_id",
            "slot_short_id",
            "sfp_index",
            name="uq_sfp_instance_slot_index",
        ),
    )