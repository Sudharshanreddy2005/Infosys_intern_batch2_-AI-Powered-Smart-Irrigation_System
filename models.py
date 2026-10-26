from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Farmer(Base):
    __tablename__ = "farmers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    state: Mapped[str | None] = mapped_column(String(80))
    district: Mapped[str | None] = mapped_column(String(100))
    village: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class FarmerField(Base):
    __tablename__ = "farmer_fields"
    __table_args__ = (Index("ix_farmer_fields_owner_name", "farmer_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    crop: Mapped[str | None] = mapped_column(String(80))
    area: Mapped[float] = mapped_column(Float, nullable=False)
    area_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FarmerCrop(Base):
    __tablename__ = "farmer_crops"
    __table_args__ = (Index("ix_farmer_crops_owner_field", "farmer_id", "field_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_id: Mapped[int | None] = mapped_column(
        ForeignKey("farmer_fields.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    variety: Mapped[str | None] = mapped_column(String(100))
    planting_date: Mapped[date | None] = mapped_column(Date)
    expected_harvest_date: Mapped[date | None] = mapped_column(Date)
    growth_stage: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
