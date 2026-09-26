package webrunner

import (
	"fmt"
	"strings"
	"time"
)

// The leads scraper and AxioIntel's review collector share one machine. Review collection runs
// all day; lead jobs pause during US business hours, when AxioIntel's customers pull most, and run
// overnight (owner's decision, 26 Sep 2026). LEADS_PAUSE_WINDOW says when, e.g.
// "08:00-20:00 America/New_York". Unset, lead jobs never pause.

// pauseWindow is a daily span of local time in one time zone. A span whose end is before its start
// runs past midnight.
type pauseWindow struct {
	from, to int // minutes after local midnight
	loc      *time.Location
	text     string
}

// parsePauseWindow reads "HH:MM-HH:MM Zone". An empty string is no window.
func parsePauseWindow(s string) (*pauseWindow, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}

	span, zone, ok := strings.Cut(s, " ")
	if !ok {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: want \"HH:MM-HH:MM Zone\", e.g. \"08:00-20:00 America/New_York\"", s)
	}

	loc, err := time.LoadLocation(strings.TrimSpace(zone))
	if err != nil {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: %w", s, err)
	}

	a, b, ok := strings.Cut(span, "-")
	if !ok {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: want \"HH:MM-HH:MM Zone\"", s)
	}

	from, err := clockMinutes(a)
	if err != nil {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: %w", s, err)
	}

	to, err := clockMinutes(b)
	if err != nil {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: %w", s, err)
	}

	if from == to {
		return nil, fmt.Errorf("LEADS_PAUSE_WINDOW %q: the window starts and ends at the same time", s)
	}

	return &pauseWindow{from: from, to: to, loc: loc, text: s}, nil
}

func clockMinutes(s string) (int, error) {
	t, err := time.Parse("15:04", strings.TrimSpace(s))
	if err != nil {
		return 0, fmt.Errorf("%q is not HH:MM", s)
	}

	return t.Hour()*60 + t.Minute(), nil
}

// active is whether lead jobs are paused at `now`.
func (p *pauseWindow) active(now time.Time) bool {
	if p == nil {
		return false
	}

	local := now.In(p.loc)
	m := local.Hour()*60 + local.Minute()

	if p.from < p.to {
		return m >= p.from && m < p.to
	}

	return m >= p.from || m < p.to
}

// until is when the pause that is on at `now` ends, in the window's own zone.
func (p *pauseWindow) until(now time.Time) time.Time {
	local := now.In(p.loc)
	end := time.Date(local.Year(), local.Month(), local.Day(), p.to/60, p.to%60, 0, 0, p.loc)

	if !end.After(local) {
		end = end.AddDate(0, 0, 1)
	}

	return end
}

// label is what the dashboard shows while the pause is on.
func (p *pauseWindow) label(now time.Time) string {
	end := p.until(now)

	return fmt.Sprintf("Lead jobs paused until %s %s (%s UTC) — review collection has the machine",
		end.Format("15:04"), end.Format("MST"), end.UTC().Format("15:04"))
}
