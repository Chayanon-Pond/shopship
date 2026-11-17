// Package testdb gives Go tests a real PostgreSQL 17 without Docker.
//
// It starts one embedded PostgreSQL server per test binary
// (github.com/fergusstrange/embedded-postgres; binaries are downloaded once to
// ~/.embedded-postgres-go and extracted into a temp dir), migrates a template
// database with every embedded goose migration, and hands each test its own
// database cloned from that template (CREATE DATABASE ... TEMPLATE), dropped
// on cleanup. Cloning takes ~100 ms, so every test can own a clean database.
//
// Usage in any package:
//
//	func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }
//
//	func TestSomething(t *testing.T) {
//		pool := testdb.New(t) // *pgxpool.Pool on a fresh, migrated DB
//		...
//	}
//
// Set SHOPSHIP_TEST_DATABASE_URL (a superuser DSN to an existing server, e.g. a
// CI service container) to skip the embedded server. Set SHOPSHIP_TEST_PG_LOG=1
// to stream the embedded server's log to stderr.
//
// This package is test-only: never import it from non-test code.
package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx" for goose

	"github.com/shopship/shop/api/migrations"
)

const templateDB = "shopship_template"

var (
	startOnce sync.Once
	startErr  error
	server    *embeddedpostgres.EmbeddedPostgres
	runtime   string
	adminDSN  string // superuser DSN to the "postgres" maintenance DB

	templateOnce sync.Once
	templateErr  error

	seq atomic.Int64
)

// Main runs the tests and always stops the embedded server afterwards. Use it
// from TestMain: os.Exit(testdb.Main(m)).
func Main(m *testing.M) int {
	code := m.Run()
	Stop()
	return code
}

// Stop shuts the embedded server down and removes its temp dir. Safe to call
// more than once or when the server never started.
func Stop() {
	if server != nil {
		_ = server.Stop()
		server = nil
	}
	if runtime != "" {
		_ = os.RemoveAll(runtime)
		runtime = ""
	}
}

func start() error {
	startOnce.Do(func() {
		if ext := strings.TrimSpace(os.Getenv("SHOPSHIP_TEST_DATABASE_URL")); ext != "" {
			adminDSN = ext
			return
		}
		port, err := freePort()
		if err != nil {
			startErr = err
			return
		}
		runtime, err = os.MkdirTemp("", "shopship-pg-*")
		if err != nil {
			startErr = err
			return
		}
		var logw io.Writer = io.Discard
		if os.Getenv("SHOPSHIP_TEST_PG_LOG") == "1" {
			logw = os.Stderr
		}
		cfg := embeddedpostgres.DefaultConfig().
			Version(embeddedpostgres.V17).
			Port(uint32(port)).
			Username("postgres").
			Password("postgres").
			Database("postgres").
			RuntimePath(filepath.Join(runtime, "rt")).
			DataPath(filepath.Join(runtime, "data")).
			Encoding("UTF8").
			Locale(locale()).
			StartTimeout(90 * time.Second).
			Logger(logw)
		server = embeddedpostgres.NewDatabase(cfg)
		if err := server.Start(); err != nil {
			startErr = fmt.Errorf("testdb: start embedded postgres: %w", err)
			server = nil
			return
		}
		adminDSN = fmt.Sprintf("postgres://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable", port)
	})
	return startErr
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// dsnFor returns adminDSN pointed at database name.
func dsnFor(name string) string {
	u, err := url.Parse(adminDSN)
	if err != nil {
		panic(err)
	}
	u.Path = "/" + name
	return u.String()
}

func exec(ctx context.Context, dsn, stmt string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.ExecContext(ctx, stmt)
	return err
}

func ensureTemplate(ctx context.Context) error {
	templateOnce.Do(func() {
		admin := dsnFor("postgres")
		_ = exec(ctx, admin, "DROP DATABASE IF EXISTS "+templateDB)
		if err := exec(ctx, admin, "CREATE DATABASE "+templateDB); err != nil {
			templateErr = fmt.Errorf("testdb: create template: %w", err)
			return
		}
		db, err := sql.Open("pgx", dsnFor(templateDB))
		if err != nil {
			templateErr = err
			return
		}
		defer db.Close()
		log := slog.New(slog.NewTextHandler(io.Discard, nil))
		if err := migrations.Run(ctx, db, log, "up"); err != nil {
			templateErr = fmt.Errorf("testdb: migrate template: %w", err)
		}
	})
	return templateErr
}

// DSN creates a fresh database and returns its DSN. When migrated is true the
// database is a clone of the fully migrated template; otherwise it is empty.
// The database is dropped when the test finishes.
func DSN(t testing.TB, migrated bool) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := start(); err != nil {
		t.Fatal(err)
	}
	stmt := "CREATE DATABASE %s"
	if migrated {
		if err := ensureTemplate(ctx); err != nil {
			t.Fatal(err)
		}
		stmt += " TEMPLATE " + templateDB
	}
	name := fmt.Sprintf("t_%d_%d", os.Getpid(), seq.Add(1))
	if err := exec(ctx, dsnFor("postgres"), fmt.Sprintf(stmt, name)); err != nil {
		t.Fatalf("testdb: create %s: %v", name, err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = exec(ctx, dsnFor("postgres"), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})
	return dsnFor(name)
}

// New returns a pool on a fresh, fully migrated database. The pool is closed
// and the database dropped when the test finishes.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	dsn := DSN(t, true)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close) // registered after the drop -> runs before it (LIFO)
	return pool
}

// locale returns the initdb locale. It must NOT be C/POSIX: pg_trgm only
// extracts trigrams from Thai text when the database ctype is a UTF-8 locale
// (verified: C and the PG17 builtin C.UTF-8 provider yield zero trigrams).
// Override with SHOPSHIP_TEST_PG_LOCALE if the host lacks en_US.UTF-8.
func locale() string {
	if l := strings.TrimSpace(os.Getenv("SHOPSHIP_TEST_PG_LOCALE")); l != "" {
		return l
	}
	return "en_US.UTF-8"
}
