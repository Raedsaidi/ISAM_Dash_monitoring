from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ConfigHistory(Base):
    __tablename__ = "config_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Qui a fait l'action (username du JWT)
    username: Mapped[str] = mapped_column(String(50), nullable=False)

    # Type d'action (ex: 'APPLY_TEMPLATE', 'APPLY_TEMPLATE_MY_PORT')
    action: Mapped[str] = mapped_column(String(50), nullable=False)

    # Contexte ISAM/port/template
    #isam_instance_id: Mapped[int] = mapped_column(
        #Integer,
        #ForeignKey("isam_instances.id", ondelete="SET NULL"),
        #nullable=False,)
    isam_instance_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    port_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    template_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("wan_templates.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Résultat
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Adresse IP de la requête
    ip_address: Mapped[str | None] = mapped_column(
        String(45),  # IPv4 ou IPv6
        nullable=True,
    )

    # Détails techniques (optionnels)
    commands_executed: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Liste des commandes exécutées, séparées par des sauts de ligne.",
    )
    raw_output: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Sortie brute de l'équipement (stdout).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # Relations (facultatives)
    isam_instance: Mapped["ISAMInstance"] = relationship("ISAMInstance")
    template: Mapped["WanTemplate"] = relationship("WanTemplate")