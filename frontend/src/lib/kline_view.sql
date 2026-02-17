-- Create a 5-minute candlestick view from raw funding_rates data
-- This view aggregates high-frequency data into OHLC candles for charting
-- Logic:
-- 1. Round timestamp down to nearest 5 minutes
-- 2. Group by bucket + symbol
-- 3. Calculate Open/High/Low/Close for each bucket

create or replace view public.funding_candlesticks_5m as
with candles as (
    select
        -- Floor timestamp to 5-minute bucket (300 seconds)
        to_timestamp(floor(extract(epoch from timestamp) / 300) * 300) as bucket,
        asset_symbol,
        median_apr,
        timestamp
    from public.funding_rates
)
select
    bucket,
    asset_symbol,
    -- fast logic for "first/last in group" without window functions
    (array_agg(median_apr order by timestamp asc))[1] as open,
    max(median_apr) as high,
    min(median_apr) as low,
    (array_agg(median_apr order by timestamp desc))[1] as close,
    count(*) as volume -- count of data points in this bucket
from candles
group by bucket, asset_symbol;

-- Comment for docs
comment on view public.funding_candlesticks_5m is '5-minute OHLC aggregation of funding_rates';
