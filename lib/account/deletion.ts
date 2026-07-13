/** Shared between the delete-request route and the purge cron so the promised date and the actual purge date can never drift apart. */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
