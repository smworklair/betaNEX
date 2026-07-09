package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func scrape(t *testing.T, r *Registry) string {
	t.Helper()
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	return rec.Body.String()
}

func TestCounterAndLabels(t *testing.T) {
	r := New()
	r.Counter("nex_http_requests_total", "Число HTTP-запросов.", "route", "status")
	r.Inc("nex_http_requests_total", "GET /healthz", "200")
	r.Inc("nex_http_requests_total", "GET /healthz", "200")
	r.Inc("nex_http_requests_total", "POST /api/v1/finance/accounts", "201")

	out := scrape(t, r)
	if !strings.Contains(out, `nex_http_requests_total{route="GET /healthz",status="200"} 2`) {
		t.Errorf("нет счётчика healthz:\n%s", out)
	}
	if !strings.Contains(out, "# TYPE nex_http_requests_total counter") {
		t.Error("нет TYPE-строки")
	}
}

func TestHistogram(t *testing.T) {
	r := New()
	r.Histogram("nex_http_request_duration_seconds", "Латентность.", nil, "route")
	r.ObserveDuration("nex_http_request_duration_seconds", 30*time.Millisecond, "GET /x")
	r.ObserveDuration("nex_http_request_duration_seconds", 700*time.Millisecond, "GET /x")

	out := scrape(t, r)
	// 0.03с попадает в бакет 0.05; 0.7с — только начиная с 1.
	if !strings.Contains(out, `le="0.05"} 1`) {
		t.Errorf("бакет 0.05 неверен:\n%s", out)
	}
	if !strings.Contains(out, `le="+Inf"} 2`) {
		t.Errorf("бакет +Inf неверен:\n%s", out)
	}
	if !strings.Contains(out, `nex_http_request_duration_seconds_count{route="GET /x"} 2`) {
		t.Errorf("count неверен:\n%s", out)
	}
}

func TestGaugeFuncAndUnknownMetric(t *testing.T) {
	r := New()
	r.GaugeFunc("nex_goroutines", func() float64 { return 42 })
	r.Inc("no_such_metric") // не должно паниковать

	out := scrape(t, r)
	if !strings.Contains(out, "nex_goroutines 42") {
		t.Errorf("нет gauge:\n%s", out)
	}
}
