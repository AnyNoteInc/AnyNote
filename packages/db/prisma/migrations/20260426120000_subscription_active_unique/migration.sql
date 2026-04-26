-- Enforce the billing invariant used by checkout/webhook/renewal flows:
-- a user can have at most one currently ACTIVE subscription.
CREATE UNIQUE INDEX "subscriptions_one_active_per_user_idx"
ON "subscriptions"("user_id")
WHERE "status" = 'ACTIVE';
