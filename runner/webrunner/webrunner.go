package webrunner

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/AxioIntel/Axio-CRED/deduper"
	"github.com/AxioIntel/Axio-CRED/exiter"
	"github.com/AxioIntel/Axio-CRED/runner"
	"github.com/AxioIntel/Axio-CRED/tlmt"
	"github.com/AxioIntel/Axio-CRED/web"
	"github.com/AxioIntel/Axio-CRED/web/leads"
	"github.com/AxioIntel/Axio-CRED/web/saleshandy"
	"github.com/AxioIntel/Axio-CRED/web/sqlite"
	"github.com/gosom/scrapemate"
	"github.com/gosom/scrapemate/adapters/writers/csvwriter"
	"github.com/gosom/scrapemate/scrapemateapp"
	"golang.org/x/sync/errgroup"
)

type webrunner struct {
	srv       *web.Server
	svc       *web.Service
	cfg       *runner.Config
	leads     *leads.Store
	setupMate func(context.Context, io.Writer, *web.Job) (mateRunner, error)
}

type mateRunner interface {
	Start(context.Context, ...scrapemate.IJob) error
	Close() error
}

func New(cfg *runner.Config) (runner.Runner, error) {
	if cfg.DataFolder == "" {
		return nil, fmt.Errorf("data folder is required")
	}

	if err := os.MkdirAll(cfg.DataFolder, os.ModePerm); err != nil {
		return nil, err
	}

	const dbfname = "jobs.db"

	dbpath := filepath.Join(cfg.DataFolder, dbfname)

	repo, err := sqlite.New(dbpath)
	if err != nil {
		return nil, err
	}

	svc := web.NewService(repo, cfg.DataFolder)

	// Every job's results also land in one deduplicated lead list, which outlives the jobs.
	leadStore, err := leads.Open(filepath.Join(cfg.DataFolder, "leads.db"))
	if err != nil {
		return nil, err
	}

	// Saleshandy: the API key comes from the environment (the machine's env file), and the
	// sequences leads may go into from saleshandy.json beside the jobs. Without a key the
	// dashboard simply has no Saleshandy button.
	shConfigPath := os.Getenv("SALESHANDY_CONFIG")
	if shConfigPath == "" {
		shConfigPath = filepath.Join(cfg.DataFolder, "saleshandy.json")
	}

	shConfig, err := saleshandy.LoadConfig(shConfigPath)
	if err != nil {
		return nil, fmt.Errorf("saleshandy config %s: %w", shConfigPath, err)
	}

	srv, err := web.New(svc, cfg.Addr, web.WithLeads(leadStore),
		web.WithSaleshandy(saleshandy.New(os.Getenv("SALESHANDY_API_KEY")), shConfig))
	if err != nil {
		return nil, err
	}

	ans := webrunner{
		srv:       srv,
		svc:       svc,
		cfg:       cfg,
		leads:     leadStore,
		setupMate: defaultSetupMate(cfg),
	}

	return &ans, nil
}

func (w *webrunner) Run(ctx context.Context) error {
	egroup, ctx := errgroup.WithContext(ctx)

	egroup.Go(func() error {
		return w.work(ctx)
	})

	egroup.Go(func() error {
		return w.srv.Start(ctx)
	})

	return egroup.Wait()
}

func (w *webrunner) Close(context.Context) error {
	if w.leads != nil {
		return w.leads.Close()
	}

	return nil
}

// ingest folds a finished job's CSV into the lead list. A job that failed part-way is ingested for
// what it found. Failures are logged, never fatal: the CSV stays and the next start retries it.
func (w *webrunner) ingest(ctx context.Context, job *web.Job) {
	if w.leads == nil {
		return
	}

	path := filepath.Join(w.cfg.DataFolder, job.ID+".csv")
	if _, err := os.Stat(path); err != nil {
		return
	}

	n, err := w.leads.IngestCSV(ctx, job.ID, path)
	if err != nil {
		log.Printf("job %s: adding its results to the lead list failed: %v", job.ID, err)

		return
	}

	log.Printf("job %s: %d result(s) added to the lead list", job.ID, n)
}

// backfill adds every finished job not yet in the lead list: the jobs run before the lead list
// existed, and any whose ingest failed.
func (w *webrunner) backfill(ctx context.Context) {
	if w.leads == nil {
		return
	}

	jobs, err := w.svc.All(ctx)
	if err != nil {
		log.Printf("lead list backfill: %v", err)

		return
	}

	for i := range jobs {
		if jobs[i].Status != web.StatusOK && jobs[i].Status != web.StatusFailed {
			continue
		}

		if done, err := w.leads.Ingested(ctx, jobs[i].ID); err == nil && !done {
			w.ingest(ctx, &jobs[i])
		}
	}
}

func (w *webrunner) work(ctx context.Context) error {
	w.backfill(ctx)

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			jobs, err := w.svc.SelectPending(ctx)
			if err != nil {
				return err
			}

			for i := range jobs {
				select {
				case <-ctx.Done():
					return nil
				default:
					t0 := time.Now().UTC()
					if err := w.scrapeJob(ctx, &jobs[i]); err != nil {
						params := map[string]any{
							"job_count": len(jobs[i].Data.Keywords),
							"duration":  time.Now().UTC().Sub(t0).String(),
							"error":     err.Error(),
						}

						evt := tlmt.NewEvent("web_runner", params)

						_ = runner.Telemetry().Send(ctx, evt)

						log.Printf("error scraping job %s: %v", jobs[i].ID, err)
					} else {
						params := map[string]any{
							"job_count": len(jobs[i].Data.Keywords),
							"duration":  time.Now().UTC().Sub(t0).String(),
						}

						_ = runner.Telemetry().Send(ctx, tlmt.NewEvent("web_runner", params))

						log.Printf("job %s scraped successfully", jobs[i].ID)
					}

					w.ingest(ctx, &jobs[i])
				}
			}
		}
	}
}

func (w *webrunner) scrapeJob(ctx context.Context, job *web.Job) error {
	job.Status = web.StatusWorking

	err := w.svc.Update(ctx, job)
	if err != nil {
		return err
	}

	if len(job.Data.Keywords) == 0 {
		job.Status = web.StatusFailed

		return w.svc.Update(ctx, job)
	}

	outpath := filepath.Join(w.cfg.DataFolder, job.ID+".csv")

	outfile, err := os.Create(outpath)
	if err != nil {
		return err
	}

	defer func() {
		_ = outfile.Close()
	}()

	setupMate := w.setupMate
	if setupMate == nil {
		setupMate = defaultSetupMate(w.cfg)
	}

	mate, err := setupMate(ctx, outfile, job)
	if err != nil {
		job.Status = web.StatusFailed

		err2 := w.svc.Update(ctx, job)
		if err2 != nil {
			log.Printf("failed to update job status: %v", err2)
		}

		return err
	}

	defer mate.Close()

	var coords string
	if job.Data.Lat != "" && job.Data.Lon != "" {
		coords = job.Data.Lat + "," + job.Data.Lon
	}

	dedup := deduper.New()
	exitMonitor := exiter.New()

	seedJobs, err := runner.CreateSeedJobs(
		job.Data.FastMode,
		job.Data.Lang,
		strings.NewReader(strings.Join(job.Data.Keywords, "\n")),
		job.Data.Depth,
		job.Data.Email,
		coords,
		job.Data.Zoom,
		func() float64 {
			if job.Data.Radius <= 0 {
				return 10000 // 10 km
			}

			return float64(job.Data.Radius)
		}(),
		dedup,
		exitMonitor,
		w.cfg.ExtraReviews || job.Data.ExtraReviews,
	)
	if err != nil {
		job.Status = web.StatusFailed

		err2 := w.svc.Update(ctx, job)
		if err2 != nil {
			log.Printf("failed to update job status: %v", err2)
		}

		return err
	}

	if len(seedJobs) > 0 {
		exitMonitor.SetSeedCount(len(seedJobs))

		allowedSeconds := max(60, len(seedJobs)*10*job.Data.Depth/50+120)

		if job.Data.MaxTime > 0 {
			if job.Data.MaxTime.Seconds() < 180 {
				allowedSeconds = 180
			} else {
				allowedSeconds = int(job.Data.MaxTime.Seconds())
			}
		}

		log.Printf("running job %s with %d seed jobs and %d allowed seconds", job.ID, len(seedJobs), allowedSeconds)

		mateCtx, cancel := context.WithTimeout(ctx, time.Duration(allowedSeconds)*time.Second)
		defer cancel()

		exitMonitor.SetCancelFunc(cancel)

		go exitMonitor.Run(mateCtx)

		err = mate.Start(mateCtx, seedJobs...)
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			cancel()

			job.Status = web.StatusFailed

			err2 := w.svc.Update(ctx, job)
			if err2 != nil {
				log.Printf("failed to update job status: %v", err2)
			}

			return err
		}

		cancel()
	}

	job.Status = web.StatusOK

	return w.svc.Update(ctx, job)
}

func defaultSetupMate(cfg *runner.Config) func(context.Context, io.Writer, *web.Job) (mateRunner, error) {
	return func(_ context.Context, writer io.Writer, job *web.Job) (mateRunner, error) {
		opts := []func(*scrapemateapp.Config) error{
			scrapemateapp.WithConcurrency(cfg.Concurrency),
			scrapemateapp.WithExitOnInactivity(time.Minute * 3),
		}

		if !job.Data.FastMode {
			opts = append(opts,
				scrapemateapp.WithJS(scrapemateapp.DisableImages()),
			)
		} else {
			opts = append(opts,
				scrapemateapp.WithStealth("firefox"),
			)
		}

		opts = runner.AppendBrowserCapacityOptions(opts, cfg)

		hasProxy := false

		if len(cfg.Proxies) > 0 {
			opts = append(opts, scrapemateapp.WithProxies(cfg.Proxies))
			hasProxy = true
		} else if len(job.Data.Proxies) > 0 {
			opts = append(opts,
				scrapemateapp.WithProxies(job.Data.Proxies),
			)
			hasProxy = true
		}

		if !cfg.DisablePageReuse {
			opts = append(opts,
				scrapemateapp.WithPageReuseLimit(2),
				scrapemateapp.WithBrowserReuseLimit(200),
			)
		}

		log.Printf("job %s has proxy: %v", job.ID, hasProxy)

		csvWriter := csvwriter.NewCsvWriter(csv.NewWriter(writer))

		writers := []scrapemate.ResultWriter{csvWriter}

		matecfg, err := scrapemateapp.NewConfig(
			writers,
			opts...,
		)
		if err != nil {
			return nil, err
		}

		return scrapemateapp.NewScrapeMateApp(matecfg)
	}
}
