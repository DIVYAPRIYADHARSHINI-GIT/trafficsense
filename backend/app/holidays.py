"""Public-holiday calendar used by the sample generator and for future predictions.

The bundled sample dataset uses the US federal holiday calendar (computed, not
hard-coded, so it works for any year). Uploaded datasets keep their own
`is_holiday` flags; see `TrafficService.resolve_holiday` for how future dates
are resolved in that case.
"""

from __future__ import annotations

import datetime as dt


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    """n-th `weekday` (Mon=0) of a month; n=-1 means the last one."""
    if n > 0:
        first = dt.date(year, month, 1)
        offset = (weekday - first.weekday()) % 7
        return first + dt.timedelta(days=offset + 7 * (n - 1))
    if month == 12:
        last = dt.date(year + 1, 1, 1) - dt.timedelta(days=1)
    else:
        last = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)


def _observed(day: dt.date) -> dt.date:
    if day.weekday() == 5:  # Saturday -> Friday
        return day - dt.timedelta(days=1)
    if day.weekday() == 6:  # Sunday -> Monday
        return day + dt.timedelta(days=1)
    return day


def us_federal_holidays(year: int) -> dict[dt.date, str]:
    holidays: dict[dt.date, str] = {}
    for month, day, name in (
        (1, 1, "New Year's Day"),
        (6, 19, "Juneteenth"),
        (7, 4, "Independence Day"),
        (11, 11, "Veterans Day"),
        (12, 25, "Christmas Day"),
    ):
        actual = dt.date(year, month, day)
        holidays[actual] = name
        observed = _observed(actual)
        if observed != actual:
            holidays.setdefault(observed, f"{name} (observed)")
    holidays[_nth_weekday(year, 1, 0, 3)] = "Martin Luther King Jr. Day"
    holidays[_nth_weekday(year, 2, 0, 3)] = "Presidents' Day"
    holidays[_nth_weekday(year, 5, 0, -1)] = "Memorial Day"
    holidays[_nth_weekday(year, 9, 0, 1)] = "Labor Day"
    holidays[_nth_weekday(year, 10, 0, 2)] = "Columbus Day"
    holidays[_nth_weekday(year, 11, 3, 4)] = "Thanksgiving Day"
    return holidays


def holidays_between(start: dt.date, end: dt.date) -> dict[dt.date, str]:
    found: dict[dt.date, str] = {}
    for year in range(start.year - 1, end.year + 2):
        for day, name in us_federal_holidays(year).items():
            if start <= day <= end:
                found[day] = name
    return dict(sorted(found.items()))
