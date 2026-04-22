from __future__ import annotations

from datetime import datetime
from sqlalchemy.dialects.mysql import DATETIME

from sqlalchemy import Integer, String, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ISAMLTSlot(Base):
    """
    Snapshot des slots LT (show equipment slot | match exact:lt)
    
    Stocke les données de chaque slot LT pour cache/snapshot.
    """
    __tablename__ = "isam_lt_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK vers ISAM instance
    isam_instance_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Slot ID (ex: "lt:1/1/5", "lt:1/1/6", etc)
    slot_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # Board (ex: "LT", "NT", etc)
    board: Mapped[str] = mapped_column(String(50), nullable=False)

    # Admin state (Up, Down)
    admin_state: Mapped[str] = mapped_column(String(20), nullable=False)

    # Link state (Yes, No)
    link_state: Mapped[str] = mapped_column(String(20), nullable=False)

    # Port state (Up, Down)
    port_state: Mapped[str] = mapped_column(String(20), nullable=False)

    # CFG MTU
    cfg_mtu: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Oper MTU
    oper_mtu: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # LAG/Bndl
    lag_bndl: Mapped[str] = mapped_column(String(20), nullable=False)

    # Mode
    mode: Mapped[str] = mapped_column(String(20), nullable=False)

    # Encap
    encap: Mapped[str] = mapped_column(String(20), nullable=False)

    # Port type (xdsl-line, ethernet-line, ont, etc)
    port_type: Mapped[str] = mapped_column(String(50), nullable=False)

    last_success_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)



    # Relationship
    instance = relationship("ISAMInstance", back_populates="lt_slots")

    # ✅ FIX: Bonne syntaxe pour les constraints
    __table_args__ = (
        UniqueConstraint('isam_instance_id', 'slot_id', name='uq_lt_slots_instance_slot'),
    )