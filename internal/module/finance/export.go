package finance

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/xlsx"
)

// RegisterStatsCommands подключает команду пересчёта витрины. Отдельно
// от RegisterCommands: витрина существует только на Postgres.
func RegisterStatsCommands(bus Registrar, repo *PostgresRepository) error {
	return bus.Register(CmdStatsRefresh, func(ctx context.Context, cmd command.Command) error {
		if _, ok := cmd.(RefreshStats); !ok {
			return fmt.Errorf("finance: %s: unexpected command type %T", CmdStatsRefresh, cmd)
		}
		return repo.RefreshStats(ctx)
	})
}

// ReportRoutes — отчётные маршруты модуля: витрина, CSV-обмен,
// XLSX-выгрузка. Монтируются только в Postgres-режиме.
//
//	GET  /api/v1/finance/stats/monthly            витрина оборотов (JSON)
//	POST /api/v1/finance/stats/refresh            пересчёт (команда шины)
//	GET  /api/v1/finance/export/accounts.csv      план счетов
//	GET  /api/v1/finance/export/entries.csv       реестр проводок
//	GET  /api/v1/finance/export/turnovers.xlsx    обороты по месяцам
//	POST /api/v1/finance/import/accounts          CSV: code,name,type[,currency]
func ReportRoutes(bus command.Bus, repo *PostgresRepository) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/v1/finance/stats/monthly", func(w http.ResponseWriter, r *http.Request) {
			rows, err := repo.MonthlyTurnovers(r.Context())
			if err != nil {
				writeCommandError(w, err)
				return
			}
			type dto struct {
				Month       string `json:"month"`
				AccountID   string `json:"account_id"`
				AccountCode string `json:"account_code"`
				AccountName string `json:"account_name"`
				Debit       int64  `json:"debit"`
				Credit      int64  `json:"credit"`
			}
			out := make([]dto, 0, len(rows))
			for _, t := range rows {
				out = append(out, dto{
					Month: t.Month.Format("2006-01"), AccountID: t.AccountID,
					AccountCode: t.AccountCode, AccountName: t.AccountName,
					Debit: t.Debit, Credit: t.Credit,
				})
			}
			httpapi.WriteJSON(w, http.StatusOK, out)
		})

		mux.HandleFunc("POST /api/v1/finance/stats/refresh", func(w http.ResponseWriter, r *http.Request) {
			if err := bus.Dispatch(r.Context(), RefreshStats{}); err != nil {
				writeCommandError(w, err)
				return
			}
			httpapi.WriteJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
		})

		mux.HandleFunc("GET /api/v1/finance/export/accounts.csv", func(w http.ResponseWriter, r *http.Request) {
			balances, err := repo.Accounts(r.Context())
			if err != nil {
				writeCommandError(w, err)
				return
			}
			cw := beginCSV(w, "accounts.csv")
			_ = cw.Write([]string{"code", "name", "type", "currency", "balance"})
			for _, b := range balances {
				_ = cw.Write([]string{
					b.Account.Code, b.Account.Name, string(b.Account.Type),
					b.Account.Currency, strconv.FormatInt(b.Amount, 10),
				})
			}
			cw.Flush()
		})

		mux.HandleFunc("GET /api/v1/finance/export/entries.csv", func(w http.ResponseWriter, r *http.Request) {
			entries, err := repo.Entries(r.Context())
			if err != nil {
				writeCommandError(w, err)
				return
			}
			cw := beginCSV(w, "entries.csv")
			_ = cw.Write([]string{"entry_id", "posted_at", "memo", "account_id", "side", "amount"})
			for _, e := range entries {
				for _, l := range e.Lines {
					_ = cw.Write([]string{
						e.ID, e.PostedAt.Format(time.RFC3339), e.Memo,
						l.AccountID, string(l.Side), strconv.FormatInt(l.Amount, 10),
					})
				}
			}
			cw.Flush()
		})

		mux.HandleFunc("GET /api/v1/finance/export/turnovers.xlsx", func(w http.ResponseWriter, r *http.Request) {
			rows, err := repo.MonthlyTurnovers(r.Context())
			if err != nil {
				writeCommandError(w, err)
				return
			}
			f := xlsx.New("Обороты")
			f.AddRow("Месяц", "Код счёта", "Счёт", "Дебет, коп.", "Кредит, коп.")
			for _, t := range rows {
				f.AddRow(t.Month.Format("2006-01"), t.AccountCode, t.AccountName, t.Debit, t.Credit)
			}
			w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			w.Header().Set("Content-Disposition", `attachment; filename="turnovers.xlsx"`)
			if err := f.Write(w); err != nil {
				// Заголовки уже ушли; остаётся только оборвать ответ.
				return
			}
		})

		mux.HandleFunc("POST /api/v1/finance/import/accounts", func(w http.ResponseWriter, r *http.Request) {
			importAccounts(w, r, bus)
		})
	}
}

// importAccounts читает CSV (code,name,type[,currency]; первая строка-
// заголовок пропускается) и проводит каждую строку обычной командой:
// валидация, авторизация и аудит — как при ручном вводе. Ошибочные
// строки не роняют импорт, а попадают в отчёт.
func importAccounts(w http.ResponseWriter, r *http.Request, bus command.Bus) {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	cr := csv.NewReader(r.Body)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true

	type rowErr struct {
		Line  int    `json:"line"`
		Error string `json:"error"`
	}
	var (
		created int
		fails   []rowErr
		line    int
	)
	for {
		line++
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fails = append(fails, rowErr{Line: line, Error: err.Error()})
			continue
		}
		if line == 1 && len(rec) > 0 && rec[0] == "code" {
			continue // заголовок
		}
		if len(rec) < 3 {
			fails = append(fails, rowErr{Line: line, Error: "нужно минимум 3 колонки: code,name,type"})
			continue
		}
		cmd := CreateAccount{Code: rec[0], DisplayName: rec[1], AccountType: AccountType(rec[2])}
		if len(rec) > 3 {
			cmd.Currency = rec[3]
		}
		if err := bus.Dispatch(r.Context(), cmd); err != nil {
			fails = append(fails, rowErr{Line: line, Error: err.Error()})
			continue
		}
		created++
	}
	httpapi.WriteJSON(w, http.StatusOK, map[string]any{
		"created": created,
		"errors":  fails,
	})
}

// beginCSV настраивает заголовки и возвращает writer c UTF-8 BOM,
// чтобы русские буквы открывались в Excel без плясок с кодировкой.
func beginCSV(w http.ResponseWriter, filename string) *csv.Writer {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = w.Write([]byte("\xEF\xBB\xBF"))
	return csv.NewWriter(w)
}
