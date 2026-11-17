// Package platform holds the dependencies shared by every domain package
// (Deps) and the narrow interfaces for swappable infrastructure (storage,
// email). Domain packages import platform; platform imports no domain package.
//
// Owner after Wave 0: api-core. Adding a field to Deps is a coordinator-reviewed
// change because every Register function receives it.
package platform

import (
	"context"
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/config"
)

// Deps is passed to every domain package's Register function.
type Deps struct {
	Cfg     config.Config
	DB      *pgxpool.Pool // nil when DATABASE_URL is unset (handlers answer 503)
	Log     *slog.Logger
	Now     func() time.Time // injectable clock; pricing receives now from here
	Storage Storage
	Mailer  Mailer
}

// Storage stores uploaded media. LocalDisk now, R2 later.
type Storage interface {
	// Put stores r under key and returns the public URL.
	Put(ctx context.Context, key, contentType string, r io.Reader) (url string, err error)
	Delete(ctx context.Context, key string) error
	URL(key string) string
}

// Mailer sends transactional email. MVP implementation only logs.
type Mailer interface {
	Send(ctx context.Context, msg Mail) error
}

type Mail struct {
	To      string
	Subject string
	Text    string
	HTML    string
}
