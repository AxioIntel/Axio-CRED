package gmaps

import (
	"context"
	"testing"
	"time"
)

func TestBlockGuardBacksOffAndResets(t *testing.T) {
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	g := &BlockGuard{now: func() time.Time { return now }}

	if s := g.Stats(); s.Recent != 0 || s.Backoff != 0 {
		t.Fatalf("fresh guard: %+v", s)
	}

	want := []time.Duration{20 * time.Second, 40 * time.Second, 80 * time.Second, 160 * time.Second, 5 * time.Minute, 5 * time.Minute}
	for i, w := range want {
		g.until = time.Time{}
		g.Refused()

		if got := g.Stats().Backoff; got != w {
			t.Fatalf("refusal %d: backoff %v, want %v", i+1, got, w)
		}
	}

	g.Loaded()
	g.until = time.Time{}
	g.Refused()

	if got := g.Stats().Backoff; got != 20*time.Second {
		t.Fatalf("after a loaded page the back-off starts again at 20s, got %v", got)
	}

	if s := g.Stats(); s.Recent != 7 || s.Total != 7 {
		t.Fatalf("counts: %+v", s)
	}

	now = now.Add(11 * time.Minute)

	if s := g.Stats(); s.Recent != 0 || s.Total != 7 || s.Backoff != 0 {
		t.Fatalf("after 11 minutes: %+v", s)
	}
}

func TestBlockGuardNeverShortensABackoff(t *testing.T) {
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	g := &BlockGuard{now: func() time.Time { return now }}

	for range 5 {
		g.Refused()
	}

	g.Loaded()
	g.Refused() // a 20 s back-off must not cut the 5 minute one short

	if got := g.Stats().Backoff; got != 5*time.Minute {
		t.Fatalf("backoff %v, want 5m", got)
	}
}

func TestBlockGuardWait(t *testing.T) {
	g := &BlockGuard{}
	if err := g.Wait(context.Background()); err != nil {
		t.Fatalf("no back-off: %v", err)
	}

	g.Refused()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := g.Wait(ctx); err == nil {
		t.Fatal("a cancelled job must stop waiting")
	}
}

func TestRefusalDetection(t *testing.T) {
	cases := []struct {
		status int
		url    string
		want   bool
	}{
		{200, "https://www.google.com/maps/search/dentist", false},
		{429, "https://www.google.com/maps/search/dentist", true},
		{403, "https://www.google.com/maps/place/x", true},
		{200, "https://www.google.com/sorry/index?continue=https://www.google.com/maps", true},
		{302, "https://ipv4.google.com/sorry/index?q=1", true},
	}
	for _, c := range cases {
		if got := refusedByResponse(c.status, c.url); got != c.want {
			t.Errorf("refusedByResponse(%d, %q) = %v", c.status, c.url, got)
		}
	}

	if !refusedByContent(`<html><body>Our systems have detected unusual traffic from your computer network.</body></html>`) {
		t.Error("the unusual-traffic page is a refusal")
	}

	if !refusedByContent(`<form id="captcha-form" action="index" method="post">`) {
		t.Error("the captcha form is a refusal")
	}

	if refusedByContent(`<html><div role="feed">Dentist near me</div></html>`) {
		t.Error("a normal results page is not a refusal")
	}
}
