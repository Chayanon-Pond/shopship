// Command devdb runs a local embedded PostgreSQL 17 for development (no
// Docker needed). Data persists in ./data/devdb between runs.
//
//	cd api && GOTOOLCHAIN=local go run ./internal/testdb/devdb
//	DATABASE_URL=postgres://shopship:shopship-dev-only@127.0.0.1:55432/shopship?sslmode=disable
//
// Flags: -port 55432 -dir ./data/devdb -locale en_US.UTF-8 (must be a UTF-8,
// non-C locale or Thai search breaks; migration 0001 refuses otherwise).
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

func main() {
	port := flag.Uint("port", 55432, "listen port (127.0.0.1)")
	dir := flag.String("dir", "./data/devdb", "data directory (persistent)")
	locale := flag.String("locale", "en_US.UTF-8", "initdb locale (UTF-8, not C)")
	flag.Parse()
	abs, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatal(err)
	}
	cfg := embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V17).
		Port(uint32(*port)).
		Username("shopship").
		Password("shopship-dev-only").
		Database("shopship").
		DataPath(filepath.Join(abs, "data")).
		RuntimePath(filepath.Join(abs, "runtime")).
		Encoding("UTF8").
		Locale(*locale).
		StartTimeout(120 * time.Second).
		Logger(os.Stderr)
	pg := embeddedpostgres.NewDatabase(cfg)
	if err := pg.Start(); err != nil {
		log.Fatalf("start embedded postgres: %v", err)
	}
	fmt.Printf("\nPostgreSQL 17 ready.\nDATABASE_URL=postgres://shopship:shopship-dev-only@127.0.0.1:%d/shopship?sslmode=disable\nCtrl-C to stop.\n", *port)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	if err := pg.Stop(); err != nil {
		log.Printf("stop: %v", err)
	}
}
