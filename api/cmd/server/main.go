// Command server runs the ShopShip HTTP API.
//
//	server               serve (default)
//	server serve
//	server migrate up|down|reset|status
//	server create-admin   (see apicore_commands.go)
//	server seed-demo      (demo catalog, users and promotions)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/email"
	apihttp "github.com/shopship/shop/api/internal/http"
	"github.com/shopship/shop/api/internal/orders"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/migrations"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Error("invalid configuration; refusing to start", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(ctx, cfg, log)
	case "migrate":
		dir := "up"
		if len(os.Args) > 2 {
			dir = os.Args[2]
		}
		err = migrate(ctx, cfg, log, dir)
	case "create-admin":
		err = createAdmin(ctx, cfg, log, os.Args[2:])
	case "seed-demo":
		err = seedDemo(ctx, cfg, log)
	case "seed-media":
		err = seedMedia(ctx, cfg, log)
	default:
		err = fmt.Errorf("unknown command %q (want serve | migrate up|down|reset|status | create-admin | seed-demo | seed-media)", cmd)
	}
	if err != nil {
		log.Error("exit", "err", err)
		os.Exit(1)
	}
}

func openDB(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	if cfg.DatabaseURL == "" {
		return nil, nil
	}
	return pgxpool.New(ctx, cfg.DatabaseURL)
}

func migrate(ctx context.Context, cfg config.Config, log *slog.Logger, dir string) error {
	db, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	if db == nil {
		return errors.New("DATABASE_URL is required for migrate")
	}
	defer db.Close()
	sqlDB := stdlib.OpenDBFromPool(db)
	defer sqlDB.Close()
	return migrations.Run(ctx, sqlDB, log, dir)
}

func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	db, err := openDB(ctx, cfg)
	if err != nil {
		return fmt.Errorf("database config invalid: %w", err)
	}
	if db == nil {
		log.Warn("DATABASE_URL not set; running without database")
	} else {
		defer db.Close()
		if cfg.MigrateOnStart {
			sqlDB := stdlib.OpenDBFromPool(db)
			err := migrations.Run(ctx, sqlDB, log, "up")
			sqlDB.Close()
			if err != nil {
				return fmt.Errorf("migrate on start: %w", err)
			}
		}
	}

	deps := &platform.Deps{
		Cfg:     cfg,
		DB:      db,
		Log:     log,
		Now:     time.Now,
		Storage: platform.LocalDisk{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL},
		Mailer:  email.New(cfg, log),
	}
	if db != nil {
		go orders.RunReservationExpiry(ctx, deps, time.Minute) // releases unpaid 15-min reservations
		go email.RunOutbox(ctx, deps, 5*time.Second)           // sends queued transactional mail with retries
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           apihttp.NewRouter(deps),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("api listening", "port", cfg.Port, "env", cfg.Env, "payments", cfg.PaymentProvider, "carrier", cfg.ShippingCarrier)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
		close(errc)
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Info("api stopped")
	return nil
}
