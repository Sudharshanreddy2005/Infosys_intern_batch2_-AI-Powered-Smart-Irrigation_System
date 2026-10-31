"""Time-slot allocation. Sessions on the same pump must never overlap."""
import math
from collections import defaultdict
from typing import List, Tuple

from . import config

Interval = Tuple[int, int]  # (start_min, end_min)


def fmt(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


class PumpCalendar:
    def __init__(self):
        self._busy = defaultdict(list)   # (pump_id, date) -> [(s, e)]

    def free_intervals(self, pump_id, day, windows=None, not_before: int = 0) -> List[Interval]:
        windows = windows or config.IRRIGATION_WINDOWS
        busy = sorted(self._busy[(pump_id, day)])
        free = []
        for ws, we in windows:
            ws = max(ws, not_before)          # time already passed today
            if ws >= we:
                continue
            cur = ws
            for bs, be in busy:
                if be <= cur or bs >= we:
                    continue
                if bs > cur:
                    free.append((cur, bs))
                cur = max(cur, be)
            if cur < we:
                free.append((cur, we))
        return free

    def book(self, pump_id, day, start, end):
        self._busy[(pump_id, day)].append((start, end))


def allocate_sessions(cal: PumpCalendar, pump_id, day, minutes_needed: float, not_before: int = 0):
    """
    Returns (sessions, remaining_minutes). sessions = [(start_min, end_min)].
    Large volumes are split into chunks of MAX_SESSION_MIN with a rest gap in between.
    """
    remaining = math.ceil(minutes_needed)
    sessions: List[Interval] = []
    for fs, fe in cal.free_intervals(pump_id, day, not_before=not_before):
        cur = fs
        while remaining > 0 and fe - cur >= config.MIN_SESSION_MIN:
            length = min(remaining, config.MAX_SESSION_MIN, fe - cur)
            if length < config.MIN_SESSION_MIN and remaining > length:
                break
            sessions.append((cur, cur + length))
            remaining -= length
            cur += length + config.REST_BETWEEN_SESSIONS_MIN
        if remaining <= 0:
            break
    for s, e in sessions:
        cal.book(pump_id, day, s, e)
    return sessions, max(remaining, 0)