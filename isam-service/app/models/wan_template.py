from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class WanTemplateScope(str, PyEnum):
    GLOBAL = "GLOBAL"
    USER_INSTANCE = "USER_INSTANCE"


class WanTemplate(Base):
    __tablename__ = "wan_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    isam_instance_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("isam_instances.id", ondelete="CASCADE"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    project: Mapped[str | None] = mapped_column(String(100), nullable=True)

    commands_template: Mapped[str] = mapped_column(Text, nullable=False)

    created_by: Mapped[str | None] = mapped_column(String(50), nullable=True)

    scope: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=WanTemplateScope.GLOBAL.value,
    )

    source_template_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("wan_templates.id", ondelete="SET NULL"),
        nullable=True,
    )

    # NEW
    saved_parameters: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
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

    isam_instance: Mapped["ISAMInstance | None"] = relationship(
        "ISAMInstance",
        backref="wan_templates",
    )

    source_template: Mapped["WanTemplate | None"] = relationship(
        "WanTemplate",
        remote_side=[id],
        foreign_keys=[source_template_id],
    )