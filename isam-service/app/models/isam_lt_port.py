from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ISAMLTPort(Base):
    """
    Snapshot des ports d'un slot LT
    
    Stocke les ports individuels extraits de:
    - show interface port | match exact:{slot_id} | match exact:xdsl-line
    - show interface port | match exact:{slot_id} | match exact:ethernet-line
    - show interface port | match exact:{slot_id} | match exact:ont
    """
    __tablename__ = "isam_lt_ports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK vers ISAM instance
    isam_instance_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Le slot parent (ex: "lt:1/1/5")
    slot_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # Port ID (ex: "1/1/5/1", "1/1/5/2", etc)
    port_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # Type de port pour ce slot
    port_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Admin state
    admin_state: Mapped[str] = mapped_column(String(20), nullable=False)

    # Link state
    link_state: Mapped[str] = mapped_column(String(20), nullable=False)

    # Port state
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

    # Board
    board: Mapped[str] = mapped_column(String(50), nullable=False)

    # Raw output line (pour debug/audit)
    raw_line: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamp du dernier snapshot réussi
    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationship
    instance = relationship("ISAMInstance", back_populates="lt_ports")

    # ✅ FIX: Bonne syntaxe pour les constraints
    __table_args__ = (
        UniqueConstraint('isam_instance_id', 'port_id', name='uq_lt_ports_instance_port'),
    )