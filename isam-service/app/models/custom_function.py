from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.db import Base


class CustomFunction(Base):
    __tablename__ = "custom_functions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    command_template = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    scope = Column(String(20), nullable=False, default="GLOBAL")  # GLOBAL or USER_INSTANCE
    isam_instance_id = Column(Integer, ForeignKey("isam_instances.id"), nullable=True)
    created_by = Column(String(80), nullable=True)
    project = Column(String(100), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationship
    instance = relationship("ISAMInstance", backref="custom_functions")

    def __repr__(self):
        return f"<CustomFunction(id={self.id}, name={self.name})>"