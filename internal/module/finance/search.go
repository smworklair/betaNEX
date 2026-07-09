package finance

import (
	"context"

	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/postgres/db"
)

// Search — полнотекстовый поиск по счетам и проводкам tenant'а
// (tsvector-колонки из миграции 00003_search.sql). Реализует
// httpapi.SearchSource для сквозного /api/v1/search.
func (r *PostgresRepository) Search(ctx context.Context, query string, limit int) ([]httpapi.SearchHit, error) {
	var hits []httpapi.SearchHit
	err := r.db.InTenantTx(ctx, func(ctx context.Context, q *db.Queries) error {
		accounts, err := q.SearchFinanceAccounts(ctx, db.SearchFinanceAccountsParams{
			WebsearchToTsquery: query,
			Limit:              int32(limit), // #nosec G115 -- limit ограничен вызывающим
		})
		if err != nil {
			return err
		}
		for _, a := range accounts {
			hits = append(hits, httpapi.SearchHit{
				Kind:  "finance.account",
				ID:    a.ID.String(),
				Title: a.Code + " — " + a.Name,
				Rank:  a.Rank,
			})
		}
		entries, err := q.SearchFinanceEntries(ctx, db.SearchFinanceEntriesParams{
			WebsearchToTsquery: query,
			Limit:              int32(limit), // #nosec G115 -- limit ограничен вызывающим
		})
		if err != nil {
			return err
		}
		for _, e := range entries {
			hits = append(hits, httpapi.SearchHit{
				Kind:    "finance.entry",
				ID:      e.ID.String(),
				Title:   e.Memo,
				Rank:    e.Rank,
				At:      e.PostedAt.Time,
				Snippet: e.Memo,
			})
		}
		return nil
	})
	return hits, mapTenantErr(err)
}
