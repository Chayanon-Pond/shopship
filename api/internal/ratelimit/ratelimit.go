// Package ratelimit is an in-memory keyed token-bucket limiter (fine for one
// API replica). Keys are e.g. "login:ip:1.2.3.4" or "login:email:a@b.c".
package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type Limiter struct {
	mu      sync.Mutex
	every   rate.Limit
	burst   int
	buckets map[string]*entry
	ttl     time.Duration
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

// New allows burst events, refilling one token per interval, per key.
func New(interval time.Duration, burst int) *Limiter {
	return &Limiter{every: rate.Every(interval), burst: burst, buckets: map[string]*entry{}, ttl: 30 * time.Minute}
}

// Allow reports whether an event for key may happen now.
func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buckets) > 10000 {
		for k, e := range l.buckets {
			if now.Sub(e.seen) > l.ttl {
				delete(l.buckets, k)
			}
		}
	}
	e, ok := l.buckets[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(l.every, l.burst)}
		l.buckets[key] = e
	}
	e.seen = now
	return e.lim.AllowN(now, 1)
}
