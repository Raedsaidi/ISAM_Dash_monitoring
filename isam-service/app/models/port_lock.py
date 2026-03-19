from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class PortLock(Base):
    __tablename__ = "port_locks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK vers ISAM instance
    isam_instance_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Port ID (ex: "1/1/5", "lt:1/1/5/1", etc)
    port_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # Username de celui qui a locké
    locked_by: Mapped[str] = mapped_column(String(100), nullable=False)

    # Quand ça a été locké
    locked_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )

    # Raison du lock (optionnel)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    instance = relationship("ISAMInstance", back_populates="port_locks")

    # ✅ FIX: Bonne syntaxe pour les constraints
    __table_args__ = (
        UniqueConstraint('isam_instance_id', 'port_id', name='uq_port_locks_instance_port'),
    )