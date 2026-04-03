# app/models/cisco_switch.py

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Float,
    Text,
    UniqueConstraint,
    Index,
)

from app.core.db import Base


class CiscoSwitch(Base):
    __tablename__ = "cisco_switches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    host = Column(String(255), nullable=False)
    ssh_port = Column(Integer, nullable=False, default=22)
    telnet_port = Column(Integer, nullable=False, default=23)
    protocol_preference = Column(String(20), nullable=False, default="auto")
    username = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)
    enable_password = Column(String(255), nullable=True)

    status = Column(String(20), nullable=False, default="inactive")
    health_protocol_used = Column(String(20), nullable=True)
    last_error = Column(Text, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    last_response_time_ms = Column(Float, nullable=True)

    device_hostname = Column(String(255), nullable=True)
    device_model = Column(String(255), nullable=True)
    ios_version = Column(String(255), nullable=True)
    serial_number = Column(String(255), nullable=True)

    cached_interfaces = Column(Text, nullable=True)
    cached_vlans = Column(Text, nullable=True)
    cache_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class CiscoPortLock(Base):
    __tablename__ = "cisco_port_locks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    switch_id = Column(Integer, nullable=False)
    port_label = Column(String(100), nullable=False)
    locked_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CiscoVlan(Base):
    __tablename__ = "cisco_vlans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vlan_id = Column(Integer, nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class CiscoPortAssignment(Base):
    __tablename__ = "cisco_port_assignments"
    __table_args__ = (
        UniqueConstraint("switch_id", "port_id", name="uq_switch_port"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    switch_id = Column(Integer, nullable=False, index=True)
    port_id = Column(String(100), nullable=False)
    switch_name = Column(String(255), nullable=False, default="")
    mode = Column(String(20), nullable=False, default="access")
    access_vlan = Column(Integer, nullable=False, default=1)
    trunk_allowed_vlans = Column(Text, nullable=True, default="[]")
    trunk_native_vlan = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="up")
    description = Column(String(255), nullable=True, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )