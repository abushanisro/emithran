// Post-login Action: puts what the backend reads into the access token (backend/src/modules/auth/auth0-token-verifier.ts).
// Only these namespaced claims count; plain email / email_verified / sid / connection claims are ignored by the backend.
// ##AUTH0_CLAIM_NAMESPACE## is filled in at deploy time and must equal AUTH0_CLAIM_NAMESPACE in the app's env (ends with "/").
exports.onExecutePostLogin = async (event, api) => {
  const ns = '##AUTH0_CLAIM_NAMESPACE##';
  api.accessToken.setCustomClaim(`${ns}email`, event.user.email);
  api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified === true);
  api.accessToken.setCustomClaim(`${ns}sid`, event.session?.id ?? '');
  api.accessToken.setCustomClaim(`${ns}connection`, event.connection.name);
};
