// What the API writes into its tokens, and checks when reading them back.
// - issuer (iss): who made the token
// - audience (aud): what it's FOR. Later steps add other kinds of token (refresh, password
//   reset); a reset token must never be accepted as a login, so each kind has its own audience.
export const TOKEN_ISSUER = 'shop-nest-api';
export const ACCESS_AUDIENCE = 'access';
