-- RH-202: One subscription row per user (plan state for billing).
--
-- The row records the plan (free | pro), its lifecycle status, the trial and
-- billing period ends, and the payment provider's own ids. The provider ids are
-- plain text so no provider-specific shape reaches the schema; `provider`
-- names which adapter owns them (`mock` until a real one is chosen).
--
-- Until billing is enforced (BILLING_ENFORCED !== 'true') nothing reads this
-- table to limit anyone: every user resolves to Pro (src/lib/subscriptions.ts).

CREATE TABLE subscriptions (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   uuid        NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    plan                      text        NOT NULL DEFAULT 'free'
                                          CHECK (plan IN ('free', 'pro')),
    status                    text        NOT NULL DEFAULT 'active'
                                          CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
    trial_ends_at             timestamptz,
    current_period_ends_at    timestamptz,
    cancel_at_period_end      boolean     NOT NULL DEFAULT false,
    provider                  text        NOT NULL DEFAULT 'mock',
    provider_customer_id      text,
    provider_subscription_id  text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_provider_subscription_id
    ON subscriptions (provider, provider_subscription_id);
