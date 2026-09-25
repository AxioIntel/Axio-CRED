//nolint:testpackage // tests the runner's unexported recovery helpers
package webrunner

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/AxioIntel/Axio-CRED/runner"
	"github.com/AxioIntel/Axio-CRED/web"
)

func TestSearchesAreTaggedWithTheirOwnWords(t *testing.T) {
	got := taggedSearches([]string{"locksmith in Austin TX", " ", "plumber#!#custom-id"})

	assert.Equal(t, "locksmith in Austin TX#!#locksmith in Austin TX\nplumber#!#custom-id", got)
}

func writeCSV(t *testing.T, dir, id, body string) string {
	t.Helper()

	p := filepath.Join(dir, id+".csv")
	require.NoError(t, os.WriteFile(p, []byte(body), 0o600))

	return p
}

func TestEmptySearchesAreTheOnesWithNoRow(t *testing.T) {
	dir := t.TempDir()
	p := writeCSV(t, dir, "j", "input_id,title\nlocksmith in Austin TX,A\nlocksmith in Austin TX,B\nlocksmith in Dallas TX,C\n")

	got := emptySearches(p, []string{"locksmith in Austin TX", "locksmith in Dallas TX", "locksmith in Houston TX"})
	assert.Equal(t, []string{"locksmith in Houston TX"}, got)

	// Nothing came back at all: a failed job, not a few empty searches.
	p = writeCSV(t, dir, "k", "input_id,title\n")
	assert.Empty(t, emptySearches(p, []string{"a", "b"}))

	// A CSV from before tagging has no input_id to go by.
	p = writeCSV(t, dir, "l", "title\nA\n")
	assert.Empty(t, emptySearches(p, []string{"a"}))
}

func newRecoveryRunner(t *testing.T) (*webrunner, *memoryJobRepo, string) {
	t.Helper()

	dir := t.TempDir()
	repo := &memoryJobRepo{}

	return &webrunner{svc: web.NewService(repo, dir), cfg: &runner.Config{DataFolder: dir}}, repo, dir
}

func TestEmptySearchesGetOneRetryJob(t *testing.T) {
	w, repo, dir := newRecoveryRunner(t)
	ctx := context.Background()

	job := web.Job{ID: "j1", Name: "Locksmiths", Date: time.Now().UTC(), Status: web.StatusOK,
		Data: web.JobData{Keywords: []string{"locksmith in Austin TX", "locksmith in Houston TX"}, Depth: 5, Email: true}}
	require.NoError(t, repo.Create(ctx, &job))
	writeCSV(t, dir, "j1", "input_id,title\nlocksmith in Austin TX,A\n")

	w.afterJob(ctx, &job)

	var retry web.Job

	for _, j := range repo.jobs {
		if j.ID != "j1" {
			retry = j
		}
	}

	require.NotEmpty(t, retry.ID, "a retry job is queued")
	assert.Equal(t, "Retry: Locksmiths", retry.Name)
	assert.Equal(t, web.StatusPending, retry.Status)
	assert.Equal(t, []string{"locksmith in Houston TX"}, retry.Data.Keywords)
	assert.True(t, retry.Data.Email, "the retry keeps the job's settings")

	// A retry that also comes back empty is not retried again.
	retry.Status = web.StatusOK
	writeCSV(t, dir, retry.ID, "input_id,title\nsomething else,X\n")

	before := len(repo.jobs)

	w.afterJob(ctx, &retry)
	assert.Len(t, repo.jobs, before)
}

func TestAStalledRunIsQueuedAgainThenFails(t *testing.T) {
	w, repo, _ := newRecoveryRunner(t)
	ctx := context.Background()

	job := web.Job{ID: "j2", Name: "Plumbers", Date: time.Now().UTC(), Status: web.StatusOK,
		Data: web.JobData{Keywords: []string{"plumber"}}}
	require.NoError(t, repo.Create(ctx, &job))

	for attempt := 1; attempt <= maxStallRetries+1; attempt++ {
		w.stalled = map[string]bool{"j2": true}
		job.Status = web.StatusOK

		w.afterJob(ctx, &job)

		want := web.StatusPending
		if attempt > maxStallRetries {
			want = web.StatusFailed
		}

		assert.Equal(t, want, repo.jobs["j2"].Status, "attempt %d", attempt)
	}
}

func TestTheWatchdogStopsAJobWithNoNewListing(t *testing.T) {
	w, _, dir := newRecoveryRunner(t)
	w.watchEvery, w.stallAfter = 10*time.Millisecond, 60*time.Millisecond

	writeCSV(t, dir, "j3", "input_id,title"+nl+"q,A"+nl) // one row, and then nothing

	stopped := make(chan struct{})

	w.setCurrent("j3", func() { close(stopped) })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go w.watchdog(ctx)

	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("the watchdog never stopped a job with no new listing")
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	assert.True(t, w.stalled["j3"], "the stop is recorded, so afterJob queues the job again")
}

func TestTheWatchdogLeavesAProgressingJobAlone(t *testing.T) {
	w, _, dir := newRecoveryRunner(t)
	w.watchEvery, w.stallAfter = 10*time.Millisecond, 80*time.Millisecond

	stopped := make(chan struct{}, 1)

	w.setCurrent("j4", func() { stopped <- struct{}{} })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go w.watchdog(ctx)

	rows := "input_id,title" + nl
	for i := range 20 {
		rows += "q,row" + strings.Repeat("x", i) + nl
		writeCSV(t, dir, "j4", rows)
		time.Sleep(15 * time.Millisecond)
	}

	select {
	case <-stopped:
		t.Fatal("a job still writing listings was stopped")
	default:
	}
}

// nl is a line break, kept out of string literals.
const nl = `
`

func TestAGridJobSeedsOneSearchPerSquare(t *testing.T) {
	w := &webrunner{cfg: &runner.Config{}}
	job := &web.Job{ID: "g", Data: web.JobData{
		Keywords: []string{"dentist", "orthodontist"}, Lang: "en", Depth: 1, Zoom: 15,
		Grid: &web.GridSpec{Area: "x", BBox: "30.10,-97.95,30.12,-97.93", CellKm: 1, Cells: 4},
	}}

	seeds, err := w.seedJobs(job, "", nil, nil)
	require.NoError(t, err)
	assert.Len(t, seeds, 8, "2 searches x 4 squares")

	job.Data.Grid = nil
	seeds, err = w.seedJobs(job, "", nil, nil)
	require.NoError(t, err)
	assert.Len(t, seeds, 2)
}
