-- Supabase Schema for kYUte Vault Dashboard Telemetry

CREATE TABLE boros_rates (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    market_address text not null,
    implied_apr numeric not null
);

CREATE TABLE funding_rates (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    source text not null,
    asset text not null,
    apr numeric not null,
    confidence numeric
);

CREATE TABLE hedge_decisions (
    id bigint generated always as identity primary key,
    timestamp timestamptz not null default now(),
    user_address text not null,
    hl_side text not null,
    boros_side text not null,
    predicted_apr numeric not null,
    boros_apr numeric not null,
    confidence numeric not null,
    should_hedge boolean not null,
    proof text not null,
    tx_hash text
);
