package main

// api-core subcommands (create-admin, seed-demo). The switch in main.go
// dispatches here; the reservation expiry job is started from serve().

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/shopship/shop/api/internal/admin/demo"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/promotions"
)

// createAdmin: server create-admin --email a@b.c --name "..." [--role owner|admin|staff]
// The password comes from $ADMIN_PASSWORD or one line on stdin (never a flag,
// so it does not land in shell history / process lists).
func createAdmin(ctx context.Context, cfg config.Config, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("create-admin", flag.ContinueOnError)
	email := fs.String("email", "", "login email")
	name := fs.String("name", "", "display name")
	role := fs.String("role", auth.RoleOwner, "owner | admin | staff")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *role != auth.RoleOwner && *role != auth.RoleAdmin && *role != auth.RoleStaff {
		return fmt.Errorf("--role must be owner, admin or staff")
	}
	em, ok := auth.NormalizeEmail(*email)
	if !ok {
		return errors.New("--email is required and must be valid")
	}
	pw := os.Getenv("ADMIN_PASSWORD")
	if pw == "" {
		fmt.Fprint(os.Stderr, "password: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return errors.New("set ADMIN_PASSWORD or pipe the password on stdin")
		}
		pw = strings.TrimRight(line, "\r\n")
	}
	if len([]rune(pw)) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	db, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	if db == nil {
		return errors.New("DATABASE_URL is required")
	}
	defer db.Close()
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}
	var id int64
	err = db.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, role, email_verified_at) VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
		RETURNING id`, em, hash, strings.TrimSpace(*name), *role).Scan(&id)
	if err != nil {
		return err
	}
	_, _ = db.Exec(ctx, `INSERT INTO audit_logs (actor_email, action, target_type, target_id, metadata)
		VALUES ('cli', 'user.create_admin', 'user', $1, jsonb_build_object('role', $2::text))`, fmt.Sprint(id), *role)
	log.Info("admin user ready", "id", id, "email", em, "role", *role)
	return nil
}

// seedDemo: server seed-demo — fills an empty database with the demo shop.
func seedDemo(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	if cfg.IsProduction() {
		return errors.New("seed-demo is refused when APP_ENV=production")
	}
	db, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	if db == nil {
		return errors.New("DATABASE_URL is required")
	}
	defer db.Close()
	if err := migrate(ctx, cfg, log, "up"); err != nil {
		return err
	}
	demo.PromotionsSeeder = promotions.SeedDemo
	storage := platform.LocalDisk{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL}
	done, err := demo.Seed(ctx, db, demo.Options{Now: time.Now(), Storage: storage, Log: log})
	if err != nil {
		return err
	}
	if done {
		log.Info("demo shop seeded; logins are listed in docs/DEMO.md")
	}
	return nil
}
