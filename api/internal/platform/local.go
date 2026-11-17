package platform

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var safeKey = regexp.MustCompile(`^[a-z0-9][a-z0-9/_.-]{0,200}$`)

// LocalDisk stores files under Dir and serves them from BaseURL + "/media/".
type LocalDisk struct {
	Dir     string
	BaseURL string
}

func (s LocalDisk) path(key string) (string, error) {
	if !safeKey.MatchString(key) || strings.Contains(key, "..") {
		return "", fmt.Errorf("storage: invalid key %q", key)
	}
	return filepath.Join(s.Dir, filepath.FromSlash(key)), nil
}

func (s LocalDisk) Put(_ context.Context, key, _ string, r io.Reader) (string, error) {
	p, err := s.path(key)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	tmp := p + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if err := os.Rename(tmp, p); err != nil {
		return "", err
	}
	return s.URL(key), nil
}

func (s LocalDisk) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s LocalDisk) URL(key string) string { return s.BaseURL + "/media/" + key }

// LogMailer writes emails to the log instead of sending them (MVP).
type LogMailer struct{ Log *slog.Logger }

func (m LogMailer) Send(_ context.Context, msg Mail) error {
	m.Log.Info("email (log driver, not sent)", "to", msg.To, "subject", msg.Subject)
	return nil
}
