package finance

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/platform/httpapi"
)

// maxBodyBytes ограничивает размер тела запроса.
const maxBodyBytes = 1 << 20 // 1 МБ

// Routes возвращает функцию монтирования маршрутов модуля — её передают
// в httpapi.RouterConfig.Mount из композиционного корня.
func Routes(bus command.Bus, repo Repository) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/v1/finance/accounts", handleCreateAccount(bus))
		mux.HandleFunc("GET /api/v1/finance/accounts", handleListAccounts(repo))
		mux.HandleFunc("POST /api/v1/finance/entries", handlePostEntry(bus))
		mux.HandleFunc("GET /api/v1/finance/entries", handleListEntries(repo))
	}
}

// --- DTO: формы запросов и ответов ------------------------------------------

type accountRequest struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Currency string `json:"currency,omitempty"`
}

type accountResponse struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Currency string `json:"currency"`
	Balance  int64  `json:"balance"` // сальдо в копейках
}

type lineDTO struct {
	AccountID string `json:"account_id"`
	Side      string `json:"side"`   // debit | credit
	Amount    int64  `json:"amount"` // в копейках, > 0
}

type entryRequest struct {
	Memo  string    `json:"memo,omitempty"`
	Lines []lineDTO `json:"lines"`
}

type entryResponse struct {
	ID       string    `json:"id"`
	Memo     string    `json:"memo,omitempty"`
	Lines    []lineDTO `json:"lines"`
	PostedBy string    `json:"posted_by,omitempty"`
	PostedAt time.Time `json:"posted_at"`
}

// --- Хендлеры -----------------------------------------------------------------

func handleCreateAccount(bus command.Bus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req accountRequest
		if !decode(w, r, &req) {
			return
		}
		cmd := CreateAccount{
			Code:        req.Code,
			DisplayName: req.Name,
			AccountType: AccountType(req.Type),
			Currency:    req.Currency,
		}
		// Валидируем до шины, чтобы отличать 400 (плохой вход) от прочих
		// ошибок; шина повторит проверку — это дёшево.
		if err := cmd.Validate(); err != nil {
			httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный запрос", err.Error())
			return
		}
		if err := bus.Dispatch(r.Context(), cmd); err != nil {
			writeCommandError(w, err)
			return
		}
		httpapi.WriteJSON(w, http.StatusCreated, map[string]string{"status": "created"})
	}
}

func handleListAccounts(repo Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		balances, err := repo.Accounts(r.Context())
		if err != nil {
			writeCommandError(w, err)
			return
		}
		out := make([]accountResponse, 0, len(balances))
		for _, b := range balances {
			out = append(out, accountResponse{
				ID:       b.Account.ID,
				Code:     b.Account.Code,
				Name:     b.Account.Name,
				Type:     string(b.Account.Type),
				Currency: b.Account.Currency,
				Balance:  b.Amount,
			})
		}
		httpapi.WriteJSON(w, http.StatusOK, out)
	}
}

func handlePostEntry(bus command.Bus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req entryRequest
		if !decode(w, r, &req) {
			return
		}
		lines := make([]Line, 0, len(req.Lines))
		for _, l := range req.Lines {
			lines = append(lines, Line{AccountID: l.AccountID, Side: Side(l.Side), Amount: l.Amount})
		}
		cmd := PostEntry{Memo: req.Memo, Lines: lines}
		if err := cmd.Validate(); err != nil {
			httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректная проводка", err.Error())
			return
		}
		if err := bus.Dispatch(r.Context(), cmd); err != nil {
			writeCommandError(w, err)
			return
		}
		httpapi.WriteJSON(w, http.StatusCreated, map[string]string{"status": "posted"})
	}
}

func handleListEntries(repo Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := repo.Entries(r.Context())
		if err != nil {
			writeCommandError(w, err)
			return
		}
		out := make([]entryResponse, 0, len(entries))
		for _, e := range entries {
			lines := make([]lineDTO, 0, len(e.Lines))
			for _, l := range e.Lines {
				lines = append(lines, lineDTO{AccountID: l.AccountID, Side: string(l.Side), Amount: l.Amount})
			}
			out = append(out, entryResponse{
				ID:       e.ID,
				Memo:     e.Memo,
				Lines:    lines,
				PostedBy: e.PostedBy,
				PostedAt: e.PostedAt,
			})
		}
		httpapi.WriteJSON(w, http.StatusOK, out)
	}
}

// --- Вспомогательные -----------------------------------------------------------

// decode разбирает JSON-тело; при ошибке сам пишет 400 и возвращает false.
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpapi.WriteProblem(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
		return false
	}
	return true
}

// writeCommandError маппит ошибки ядра и хранилища в HTTP-статусы.
func writeCommandError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, authz.ErrDenied):
		httpapi.WriteProblem(w, http.StatusForbidden, "Доступ запрещён", err.Error())
	case errors.Is(err, ErrNoTenant):
		httpapi.WriteProblem(w, http.StatusBadRequest, "Не указан tenant", err.Error())
	case errors.Is(err, ErrAccountNotFound):
		httpapi.WriteProblem(w, http.StatusNotFound, "Счёт не найден", err.Error())
	case errors.Is(err, ErrDuplicateCode):
		httpapi.WriteProblem(w, http.StatusConflict, "Код счёта занят", err.Error())
	case errors.Is(err, ErrCurrencyMismatch), errors.Is(err, ErrUnbalanced):
		httpapi.WriteProblem(w, http.StatusUnprocessableEntity, "Проводка отклонена", err.Error())
	default:
		httpapi.WriteProblem(w, http.StatusInternalServerError, "Внутренняя ошибка", err.Error())
	}
}
