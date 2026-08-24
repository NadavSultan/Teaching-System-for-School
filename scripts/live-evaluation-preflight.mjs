if (
  process.env.PHASE40_LIVE_APPROVED === 'true' &&
  process.env.PHASE40_LIVE_ADAPTER === 'configured'
) {
  console.log('LIVE_EVALUATION_ADAPTER_PRESENT=OWNER_APPROVAL_REQUIRED');
  process.exit(0);
}
console.log('LIVE_EVALUATION=DISABLED_BY_DEFAULT');
