package finance

import (
	"errors"
	"testing"
)

func TestCreateAccountValidate(t *testing.T) {
	cases := []struct {
		name    string
		cmd     CreateAccount
		wantErr bool
	}{
		{"корректный счёт", CreateAccount{Code: "50", DisplayName: "Касса", AccountType: AccountAsset}, false},
		{"с валютой", CreateAccount{Code: "51", DisplayName: "Банк", AccountType: AccountAsset, Currency: "RUB"}, false},
		{"без кода", CreateAccount{DisplayName: "Касса", AccountType: AccountAsset}, true},
		{"без имени", CreateAccount{Code: "50", AccountType: AccountAsset}, true},
		{"неизвестный тип", CreateAccount{Code: "50", DisplayName: "Касса", AccountType: "bogus"}, true},
		{"кривая валюта", CreateAccount{Code: "50", DisplayName: "Касса", AccountType: AccountAsset, Currency: "RUBLES"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.cmd.Validate()
			if (err != nil) != tc.wantErr {
				t.Errorf("Validate() err = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

func TestPostEntryValidate(t *testing.T) {
	ok := []Line{
		{AccountID: "a1", Side: Debit, Amount: 1000},
		{AccountID: "a2", Side: Credit, Amount: 1000},
	}
	cases := []struct {
		name    string
		lines   []Line
		wantErr bool
	}{
		{"сбалансированная", ok, false},
		{"одна строка", ok[:1], true},
		{"нет строк", nil, true},
		{"дисбаланс", []Line{
			{AccountID: "a1", Side: Debit, Amount: 1000},
			{AccountID: "a2", Side: Credit, Amount: 900},
		}, true},
		{"нулевая сумма", []Line{
			{AccountID: "a1", Side: Debit, Amount: 0},
			{AccountID: "a2", Side: Credit, Amount: 0},
		}, true},
		{"отрицательная сумма", []Line{
			{AccountID: "a1", Side: Debit, Amount: -100},
			{AccountID: "a2", Side: Credit, Amount: -100},
		}, true},
		{"неизвестная сторона", []Line{
			{AccountID: "a1", Side: "left", Amount: 100},
			{AccountID: "a2", Side: Credit, Amount: 100},
		}, true},
		{"пустой счёт", []Line{
			{AccountID: "", Side: Debit, Amount: 100},
			{AccountID: "a2", Side: Credit, Amount: 100},
		}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := PostEntry{Lines: tc.lines}.Validate()
			if (err != nil) != tc.wantErr {
				t.Errorf("Validate() err = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

func TestPostEntryValidateUnbalancedSentinel(t *testing.T) {
	err := PostEntry{Lines: []Line{
		{AccountID: "a1", Side: Debit, Amount: 500},
		{AccountID: "a2", Side: Credit, Amount: 300},
	}}.Validate()
	if !errors.Is(err, ErrUnbalanced) {
		t.Errorf("err = %v, want ErrUnbalanced", err)
	}
}

func TestSignFor(t *testing.T) {
	cases := []struct {
		t    AccountType
		s    Side
		want int64
	}{
		{AccountAsset, Debit, 1},
		{AccountAsset, Credit, -1},
		{AccountExpense, Debit, 1},
		{AccountIncome, Credit, 1},
		{AccountIncome, Debit, -1},
		{AccountLiability, Credit, 1},
		{AccountEquity, Credit, 1},
	}
	for _, tc := range cases {
		if got := signFor(tc.t, tc.s); got != tc.want {
			t.Errorf("signFor(%s, %s) = %d, want %d", tc.t, tc.s, got, tc.want)
		}
	}
}
