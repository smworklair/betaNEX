// Package metrics — метрики в текстовом формате Prometheus без внешних
// зависимостей. Экспорт бесплатен: /metrics отдаёт текст, а ставить ли
// рядом Prometheus/Grafana — решение эксплуатации, не кода.
//
// Реализован минимум, который реально нужен NEX: счётчики и гистограммы
// с метками плюс gauge-функции (читаются в момент скрейпа — так
// отдаются pgxpool.Stat и runtime-показатели). Если аппетиты вырастут
// до exemplars и native histograms — возьмём client_golang, интерфейс
// вызывающего кода не изменится.
package metrics

import (
	"fmt"
	"math"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// DefBuckets — границы гистограммы латентности, как у Prometheus.
var DefBuckets = []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}

// Registry хранит все метрики процесса и умеет отдавать их текстом.
type Registry struct {
	mu     sync.Mutex
	names  []string // порядок регистрации — стабильный вывод
	series map[string]*family
	gauges map[string]func() float64
}

// family — одна метрика со всеми комбинациями меток.
type family struct {
	help    string
	kind    string // counter | histogram
	labels  []string
	buckets []float64
	rows    map[string]*row // ключ — сериализованные значения меток
}

type row struct {
	labelVals []string
	count     uint64   // counter: значение; histogram: число наблюдений
	sum       float64  // histogram: сумма наблюдений
	bucketCnt []uint64 // histogram: попадания по бакетам
}

// New создаёт пустой реестр.
func New() *Registry {
	return &Registry{
		series: make(map[string]*family),
		gauges: make(map[string]func() float64),
	}
}

// Counter регистрирует счётчик с метками (идемпотентно).
func (r *Registry) Counter(name, help string, labels ...string) {
	r.register(name, &family{help: help, kind: "counter", labels: labels, rows: map[string]*row{}})
}

// Histogram регистрирует гистограмму с метками (идемпотентно).
func (r *Registry) Histogram(name, help string, buckets []float64, labels ...string) {
	if len(buckets) == 0 {
		buckets = DefBuckets
	}
	r.register(name, &family{help: help, kind: "histogram", labels: labels, buckets: buckets, rows: map[string]*row{}})
}

// GaugeFunc регистрирует показатель, вычисляемый в момент скрейпа.
func (r *Registry) GaugeFunc(name string, fn func() float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.gauges[name]; !dup {
		r.names = append(r.names, name)
	}
	r.gauges[name] = fn
}

func (r *Registry) register(name string, f *family) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.series[name]; dup {
		return
	}
	r.names = append(r.names, name)
	r.series[name] = f
}

// Inc увеличивает счётчик на 1 для данной комбинации меток.
func (r *Registry) Inc(name string, labelVals ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.series[name]
	if f == nil || f.kind != "counter" {
		return // незарегистрированная метрика — no-op, не паника
	}
	f.row(labelVals).count++
}

// Observe добавляет наблюдение в гистограмму.
func (r *Registry) Observe(name string, v float64, labelVals ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.series[name]
	if f == nil || f.kind != "histogram" {
		return
	}
	rw := f.row(labelVals)
	rw.count++
	rw.sum += v
	for i, b := range f.buckets {
		if v <= b {
			rw.bucketCnt[i]++
		}
	}
}

// ObserveDuration — сахар для латентностей в секундах.
func (r *Registry) ObserveDuration(name string, d time.Duration, labelVals ...string) {
	r.Observe(name, d.Seconds(), labelVals...)
}

func (f *family) row(vals []string) *row {
	key := strings.Join(vals, "\x00")
	rw := f.rows[key]
	if rw == nil {
		rw = &row{labelVals: vals, bucketCnt: make([]uint64, len(f.buckets))}
		f.rows[key] = rw
	}
	return rw
}

// Handler отдаёт метрики в текстовом формате Prometheus 0.0.4.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		r.mu.Lock()
		defer r.mu.Unlock()
		var b strings.Builder
		for _, name := range r.names {
			if fn, ok := r.gauges[name]; ok {
				fmt.Fprintf(&b, "# TYPE %s gauge\n%s %s\n", name, name, fmtFloat(fn()))
				continue
			}
			f := r.series[name]
			fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", name, f.help, name, f.kind)
			keys := make([]string, 0, len(f.rows))
			for k := range f.rows {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				rw := f.rows[k]
				switch f.kind {
				case "counter":
					fmt.Fprintf(&b, "%s%s %d\n", name, labelStr(f.labels, rw.labelVals, ""), rw.count)
				case "histogram":
					cum := uint64(0)
					for i, bound := range f.buckets {
						cum += rw.bucketCnt[i]
						fmt.Fprintf(&b, "%s_bucket%s %d\n", name,
							labelStr(f.labels, rw.labelVals, fmtFloat(bound)), cum)
					}
					fmt.Fprintf(&b, "%s_bucket%s %d\n", name, labelStr(f.labels, rw.labelVals, "+Inf"), rw.count)
					fmt.Fprintf(&b, "%s_sum%s %s\n", name, labelStr(f.labels, rw.labelVals, ""), fmtFloat(rw.sum))
					fmt.Fprintf(&b, "%s_count%s %d\n", name, labelStr(f.labels, rw.labelVals, ""), rw.count)
				}
			}
		}
		_, _ = w.Write([]byte(b.String()))
	})
}

// RegisterRuntime добавляет базовые показатели Go-рантайма.
func (r *Registry) RegisterRuntime() {
	r.GaugeFunc("nex_goroutines", func() float64 { return float64(runtime.NumGoroutine()) })
	r.GaugeFunc("nex_heap_alloc_bytes", func() float64 {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return float64(m.HeapAlloc)
	})
}

// labelStr собирает {a="x",b="y"[,le="bound"]}.
func labelStr(names, vals []string, le string) string {
	if len(names) == 0 && le == "" {
		return ""
	}
	var parts []string
	for i, n := range names {
		v := ""
		if i < len(vals) {
			v = vals[i]
		}
		parts = append(parts, fmt.Sprintf("%s=%q", n, escape(v)))
	}
	if le != "" {
		parts = append(parts, fmt.Sprintf("le=%q", le))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func escape(s string) string {
	return strings.NewReplacer(`\`, `\\`, "\n", `\n`, `"`, `\"`).Replace(s)
}

func fmtFloat(v float64) string {
	if math.IsInf(v, 1) {
		return "+Inf"
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", v), "0"), ".")
}
