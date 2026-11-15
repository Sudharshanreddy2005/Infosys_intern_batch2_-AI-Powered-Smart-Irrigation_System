
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Alert


def create_alert(db: Session, alert_data: dict):
    """
    Save a new alert only if an unresolved alert
    of the same type does not already exist.
    """

    existing_alert = db.scalar(
        select(Alert).where(
            Alert.farmer_id == alert_data["farmer_id"],
            Alert.field_id == alert_data["field_id"],
            Alert.alert_type == alert_data["alert_type"],
            Alert.status == "unresolved",
        )
    )

    if existing_alert:
        return existing_alert

    alert = Alert(**alert_data)

    db.add(alert)
    db.commit()
    db.refresh(alert)

    return alert


def get_farmer_alerts(
    db: Session,
    farmer_id: int,
    unread_only: bool = False,
):
    """Get alerts belonging to a farmer."""

    query = select(Alert).where(Alert.farmer_id == farmer_id)

    if unread_only:
        query = query.where(Alert.is_read.is_(False))

    query = query.order_by(Alert.created_at.desc())

    return db.scalars(query).all()


def mark_alert_as_read(
    db: Session,
    alert_id: int,
    farmer_id: int,
):
    """Mark a farmer's alert as read."""

    alert = db.scalar(
        select(Alert).where(
            Alert.id == alert_id,
            Alert.farmer_id == farmer_id,
        )
    )

    if alert is None:
        return None

    alert.is_read = True
    db.commit()
    db.refresh(alert)

    return alert


def resolve_alert(
    db: Session,
    alert_id: int,
    farmer_id: int,
):
    """Mark a farmer's alert as resolved."""

    alert = db.scalar(
        select(Alert).where(
            Alert.id == alert_id,
            Alert.farmer_id == farmer_id,
        )
    )

    if alert is None:
        return None

    alert.status = "resolved"
    db.commit()
    db.refresh(alert)

    return alert
