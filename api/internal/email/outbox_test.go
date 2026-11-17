package email_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopship/shop/api/internal/email"
	"github.com/shopship/shop/api/internal/orders"
	"github.com/shopship/shop/api/internal/orders/state"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

// placeOrder checks out qty of a fresh product as a fresh customer.
func placeOrder(t *testing.T, e *apitest.Env, mail string) (orderID int64, orderNo string) {
	t.Helper()
	_, vid := e.Product("p-"+strings.NewReplacer("@", "-", ".", "-").Replace(mail), "เสื้อยืดคอตตอน", 29000, 10)
	uid := e.UserNoPassword(mail, "customer")
	addr := e.Address(uid)
	c := e.SessionClient(uid)
	c.Do("POST", "/api/v1/cart/items", map[string]any{"variant_id": vid, "qty": 2}).Must(t, 200)
	var q struct {
		QuoteHash string `json:"quote_hash"`
	}
	c.Do("POST", "/api/v1/cart/quote", map[string]any{"address_id": addr}).Must(t, 200).Data(t, &q)
	var o struct {
		OrderNo string `json:"order_no"`
	}
	c.Do("POST", "/api/v1/orders", map[string]any{"address_id": addr, "payment_method": "promptpay", "quote_hash": q.QuoteHash},
		"Idempotency-Key", "key-"+mail).Must(t, 201).Data(t, &o)
	e.Scalar(&orderID, `SELECT id FROM orders WHERE order_no = $1`, o.OrderNo)
	return orderID, o.OrderNo
}

func outboxCount(e *apitest.Env, where string, args ...any) int {
	var n int
	e.Scalar(&n, `SELECT count(*) FROM email_outbox WHERE `+where, args...)
	return n
}

func transition(t *testing.T, e *apitest.Env, orderID int64, to string) {
	t.Helper()
	ctx := context.Background()
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := state.Transition(ctx, tx, orderID, to, nil, "test"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestOutboxLifecycle(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()

	// registration -> welcome queued in the same tx
	c := e.Client()
	c.Do("POST", "/api/v1/auth/register", map[string]any{"email": "new@example.com", "password": "password-123", "name": "นิดา"}).Must(t, 201)
	if n := outboxCount(e, `kind = 'welcome' AND to_email = 'new@example.com' AND status = 'pending'`); n != 1 {
		t.Fatalf("welcome rows = %d", n)
	}

	orderID, orderNo := placeOrder(t, e, "buyer@example.com")
	if n := outboxCount(e, `kind = 'order_placed' AND order_id = $1 AND to_email = 'buyer@example.com'`, orderID); n != 1 {
		t.Fatalf("order_placed rows = %d", n)
	}

	// enqueue is idempotent per (order, event)
	if err := email.EnqueueOrder(ctx, e.Pool, email.KindOrderPlaced, orderID, "", nil); err != nil {
		t.Fatal(err)
	}
	if n := outboxCount(e, `order_id = $1`, orderID); n != 1 {
		t.Fatalf("duplicate enqueue created a row (%d)", n)
	}

	// enqueue joins the caller's tx: a rolled-back state change leaves no mail
	tx, err := e.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := state.Transition(ctx, tx, orderID, state.Paid, nil, "rollback"); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	if n := outboxCount(e, `kind = 'payment_received'`); n != 0 {
		t.Fatalf("rolled-back transition left %d mails", n)
	}

	// worker sends both; the order mail still offers the pay link (unpaid)
	res, err := email.ProcessDue(ctx, e.Deps, 50)
	if err != nil || res.Sent != 2 {
		t.Fatalf("process = %+v %v", res, err)
	}
	var placed platform.Mail
	for _, m := range e.Mail.Sent {
		if m.To == "buyer@example.com" {
			placed = m
		}
	}
	if !strings.Contains(placed.Subject, orderNo) || !strings.Contains(placed.HTML, "/checkout/pay/"+orderNo) ||
		!strings.Contains(placed.Text, "฿580") || !strings.Contains(placed.HTML, "เสื้อยืดคอตตอน") {
		t.Fatalf("order_placed mail: %q\n%s", placed.Subject, placed.Text)
	}
	if n := outboxCount(e, `status = 'sent' AND sent_at IS NOT NULL AND attempts = 1`); n != 2 {
		t.Fatalf("sent rows = %d", n)
	}
	if res, _ := email.ProcessDue(ctx, e.Deps, 50); res.Sent != 0 {
		t.Fatal("sent rows must not be sent again")
	}

	// paid -> packing -> shipped (with a parcel) -> delivered
	transition(t, e, orderID, state.Paid)
	transition(t, e, orderID, state.Packing)
	e.Exec(`INSERT INTO shipments (order_id, carrier, tracking_no) VALUES ($1, 'flash_mock', 'FMK0000001')`, orderID)
	transition(t, e, orderID, state.Shipped)
	transition(t, e, orderID, state.Delivered)
	e.Mail.Sent = nil
	if res, err := email.ProcessDue(ctx, e.Deps, 50); err != nil || res.Sent != 3 {
		t.Fatalf("process = %+v %v", res, err)
	}
	subjects := ""
	var shipped platform.Mail
	for _, m := range e.Mail.Sent {
		subjects += m.Subject + "|"
		if strings.HasPrefix(m.Subject, "จัดส่งแล้ว") {
			shipped = m
		}
	}
	for _, w := range []string{"ชำระเงินสำเร็จ", "จัดส่งแล้ว", "ส่งถึงแล้ว"} {
		if !strings.Contains(subjects, w) {
			t.Fatalf("missing %q in %s", w, subjects)
		}
	}
	if !strings.Contains(shipped.Text, "FMK0000001") || !strings.Contains(shipped.HTML, "/account/orders/"+orderNo) {
		t.Fatalf("shipped mail lacks tracking: %s", shipped.Text)
	}

	// expiry: an unpaid order past its window -> order_expired (not cancelled)
	exp, _ := placeOrder(t, e, "late@example.com")
	e.Advance(16 * time.Minute)
	if n, err := orders.ExpireNow(ctx, e.Deps); err != nil || n != 1 {
		t.Fatalf("expire = %d %v", n, err)
	}
	if n := outboxCount(e, `kind = 'order_expired' AND order_id = $1`, exp); n != 1 {
		t.Fatalf("order_expired rows = %d", n)
	}
	// refund mail per payment
	if err := email.EnqueueRefund(ctx, e.Pool, exp, 99, 58000, true); err != nil {
		t.Fatal(err)
	}
	e.Mail.Sent = nil
	if res, err := email.ProcessDue(ctx, e.Deps, 50); err != nil || res.Sent != 3 { // order_placed + expired + refund
		t.Fatalf("process = %+v %v", res, err)
	}
	var refund, expired platform.Mail
	for _, m := range e.Mail.Sent {
		switch {
		case strings.HasPrefix(m.Subject, "คืนเงิน"):
			refund = m
		case strings.Contains(m.Subject, "หมดเวลาชำระเงิน"):
			expired = m
		}
	}
	if !strings.Contains(refund.Subject, "฿580") || !strings.Contains(refund.Text, "หลังจากคำสั่งซื้อถูกยกเลิก") {
		t.Fatalf("refund mail: %q %s", refund.Subject, refund.Text)
	}
	if expired.To != "late@example.com" {
		t.Fatal("expired mail not sent")
	}
}

// flaky fails the first n sends with a transient error.
type flaky struct {
	fails atomic.Int32
	n     int32
	perm  bool
	sent  atomic.Int32
}

func (f *flaky) Send(context.Context, platform.Mail) error {
	if f.perm {
		return email.Permanent(errors.New("rejected"))
	}
	if f.fails.Add(1) <= f.n {
		return errors.New("temporary outage")
	}
	f.sent.Add(1)
	return nil
}

func TestOutboxRetryBackoffAndFailure(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	uid := e.UserNoPassword("retry@example.com", "customer")
	if err := email.EnqueueWelcome(ctx, e.Pool, uid); err != nil {
		t.Fatal(err)
	}
	f := &flaky{n: 2}
	e.Deps.Mailer = f

	for attempt := 1; attempt <= 2; attempt++ {
		res, err := email.ProcessDue(ctx, e.Deps, 10)
		if err != nil || res.Retried != 1 {
			t.Fatalf("attempt %d: %+v %v", attempt, res, err)
		}
		// not due again until the backoff has passed
		if res, _ := email.ProcessDue(ctx, e.Deps, 10); res.Retried+res.Sent+res.Failed != 0 {
			t.Fatalf("attempt %d: retried before backoff", attempt)
		}
		var lastErr string
		e.Scalar(&lastErr, `SELECT last_error FROM email_outbox WHERE user_id = $1`, uid)
		if lastErr != "temporary outage" {
			t.Fatalf("last_error = %q", lastErr)
		}
		e.Advance(email.Backoff(attempt) + time.Second)
	}
	if res, err := email.ProcessDue(ctx, e.Deps, 10); err != nil || res.Sent != 1 {
		t.Fatalf("third attempt: %+v %v", res, err)
	}
	var attempts int
	var status string
	e.Scalar(&attempts, `SELECT attempts FROM email_outbox WHERE user_id = $1`, uid)
	e.Scalar(&status, `SELECT status FROM email_outbox WHERE user_id = $1`, uid)
	if attempts != 3 || status != "sent" || f.sent.Load() != 1 {
		t.Fatalf("attempts=%d status=%s sent=%d", attempts, status, f.sent.Load())
	}

	// max_attempts reached -> failed
	u2 := e.UserNoPassword("max@example.com", "customer")
	if err := email.EnqueueWelcome(ctx, e.Pool, u2); err != nil {
		t.Fatal(err)
	}
	e.Exec(`UPDATE email_outbox SET max_attempts = 2 WHERE user_id = $1`, u2)
	e.Deps.Mailer = &flaky{n: 100}
	email.ProcessDue(ctx, e.Deps, 10) //nolint:errcheck
	e.Advance(time.Hour)
	if res, _ := email.ProcessDue(ctx, e.Deps, 10); res.Failed != 1 {
		t.Fatalf("max attempts: %+v", res)
	}

	// permanent error -> failed on the first attempt
	u3 := e.UserNoPassword("perm@example.com", "customer")
	if err := email.EnqueueWelcome(ctx, e.Pool, u3); err != nil {
		t.Fatal(err)
	}
	e.Deps.Mailer = &flaky{perm: true}
	if res, _ := email.ProcessDue(ctx, e.Deps, 10); res.Failed != 1 {
		t.Fatalf("permanent: %+v", res)
	}
	if n := outboxCount(e, `status = 'failed' AND last_error <> ''`); n != 2 {
		t.Fatalf("failed rows = %d", n)
	}
}

// counting records how often each recipient got mail.
type counting struct {
	mu  sync.Mutex
	got map[string]int
}

func (c *counting) Send(_ context.Context, m platform.Mail) error {
	time.Sleep(2 * time.Millisecond)
	c.mu.Lock()
	c.got[m.To]++
	c.mu.Unlock()
	return nil
}

func TestOutboxConcurrentWorkersSendOnce(t *testing.T) {
	e := apitest.New(t)
	ctx := context.Background()
	const n = 40
	for i := 0; i < n; i++ {
		uid := e.UserNoPassword("c"+string(rune('a'+i%26))+string(rune('a'+i/26))+"@example.com", "customer")
		if err := email.EnqueueWelcome(ctx, e.Pool, uid); err != nil {
			t.Fatal(err)
		}
	}
	m := &counting{got: map[string]int{}}
	e.Deps.Mailer = m
	var wg sync.WaitGroup
	var sent atomic.Int32
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := email.ProcessDue(ctx, e.Deps, n)
			if err != nil {
				t.Error(err)
			}
			sent.Add(int32(res.Sent))
		}()
	}
	wg.Wait()
	if sent.Load() != n || len(m.got) != n {
		t.Fatalf("sent=%d recipients=%d", sent.Load(), len(m.got))
	}
	for to, k := range m.got {
		if k != 1 {
			t.Fatalf("%s got %d mails", to, k)
		}
	}
}
