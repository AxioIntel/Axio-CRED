package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/urfave/cli/v3"

	"github.com/AxioIntel/Axio-CRED/cmd/gmapssaas/cmdadmin"
	"github.com/AxioIntel/Axio-CRED/cmd/gmapssaas/cmdprovision"
	"github.com/AxioIntel/Axio-CRED/cmd/gmapssaas/cmdserve"
	"github.com/AxioIntel/Axio-CRED/cmd/gmapssaas/cmdupdate"
	"github.com/AxioIntel/Axio-CRED/cmd/gmapssaas/cmdworker"
	"github.com/AxioIntel/Axio-CRED/log"

	// Register infrastructure providers.
	_ "github.com/AxioIntel/Axio-CRED/infra/digitalocean"
	_ "github.com/AxioIntel/Axio-CRED/infra/hetzner"
)

func main() {
	cmd := &cli.Command{
		Name:    "gmapssaas",
		Usage:   "Google Maps Scraper Pro",
		Version: "1.0.0",
		Flags: []cli.Flag{
			&cli.BoolFlag{
				Name:  "debug",
				Usage: "Enable debug logging",
			},
		},
		Before: func(ctx context.Context, cmd *cli.Command) (context.Context, error) {
			level := slog.LevelInfo
			if cmd.Bool("debug") {
				level = slog.LevelDebug
			}
			log.Init(level)
			return ctx, nil
		},
		Commands: []*cli.Command{
			cmdserve.Command,
			cmdworker.Command,
			cmdprovision.Command,
			cmdupdate.Command,
			cmdadmin.Command,
		},
	}

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		log.Error("application failed", "error", err)
		os.Exit(1)
	}
}
