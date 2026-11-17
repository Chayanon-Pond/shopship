package auth

import "crypto/subtle"

func csrfEqual(want, got string) bool {
	return want != "" && len(want) == len(got) && subtle.ConstantTimeCompare([]byte(want), []byte(got)) == 1
}
