package authz

import "errors"

// ErrDenied — базовая ошибка отказа в доступе. Проверяется через
// errors.Is; HTTP-слой отобразит её в 403.
var ErrDenied = errors.New("authz: access denied")

// Policy — статическая RBAC-политика: роль → множество прав.
//
// Политика строится один раз при старте приложения (модули объявляют
// свои права, приложение раздаёт их ролям) и дальше только читается,
// поэтому Grant не потокобезопасен, а Allows — безопасен для
// конкурентного чтения.
type Policy struct {
	grants map[string]map[string]struct{}
}

// NewPolicy создаёт пустую политику.
func NewPolicy() *Policy {
	return &Policy{grants: make(map[string]map[string]struct{})}
}

// Grant разрешает роли право permission. Вызывается только при старте.
func (p *Policy) Grant(role, permission string) {
	if p.grants[role] == nil {
		p.grants[role] = make(map[string]struct{})
	}
	p.grants[role][permission] = struct{}{}
}

// Allows отвечает, есть ли право permission хотя бы у одной из ролей.
func (p *Policy) Allows(roles []string, permission string) bool {
	for _, r := range roles {
		if _, ok := p.grants[r][permission]; ok {
			return true
		}
	}
	return false
}
