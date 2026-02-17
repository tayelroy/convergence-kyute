
import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback } from '@klinecharts/pro';
import { KLineData } from 'klinecharts';
import { supabase } from '@/lib/supabaseClient';

export class FundingRateDatafeed implements Datafeed {
    private subscribers: Map<string, { callback: DatafeedSubscribeCallback, channel: any }> = new Map();

    /**
     * Fuzzy search symbols
     */
    async searchSymbols(search?: string): Promise<SymbolInfo[]> {
        // For now, return static symbols. In future, we could search DB.
        const symbols: SymbolInfo[] = [
            {
                ticker: 'BTC',
                name: 'Bitcoin',
                shortName: 'BTC',
                exchange: 'CONSENSUS',
                market: 'crypto',
                priceCurrency: 'apr',
                type: 'index',
                pricePrecision: 2
            },
            {
                ticker: 'ETH',
                name: 'Ethereum',
                shortName: 'ETH',
                exchange: 'CONSENSUS',
                market: 'crypto',
                priceCurrency: 'apr',
                type: 'index',
                pricePrecision: 2
            }
        ];

        if (search) {
            return symbols.filter(s =>
                s.ticker.toLowerCase().includes(search.toLowerCase()) ||
                (s.name || '').toLowerCase().includes(search.toLowerCase())
            );
        }
        return symbols;
    }

    /**
     * Pull historical k-line data
     */
    async getHistoryKLineData(symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
        // Query the 5-minute candlestick view
        // Columns: bucket, asset_symbol, open, high, low, close, volume
        const { data: rows, error } = await supabase
            .from('funding_candlesticks_5m')
            .select('*')
            .eq('asset_symbol', symbol.ticker)
            .gte('bucket', new Date(from).toISOString())
            .lte('bucket', new Date(to).toISOString())
            .order('bucket', { ascending: true })
            .limit(1000); // Reasonable limit for chart load

        if (error) {
            console.error("Datafeed Error:", error);
            return [];
        }

        if (!rows || rows.length === 0) {
            return [];
        }

        const candles: KLineData[] = rows.map((row: any) => ({
            timestamp: new Date(row.bucket).getTime(),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume)
        }));

        return candles;
    }

    /**
     * Helper to fetch a single specific 5m candle from the view.
     * Used for real-time updates to ensure we have the correct aggregated OHLC
     * instead of overwriting with a single point.
     */
    async fetchSingleCandle(symbol: SymbolInfo, bucketTime: number): Promise<KLineData | null> {
        const { data: rows } = await supabase
            .from('funding_candlesticks_5m')
            .select('*')
            .eq('asset_symbol', symbol.ticker)
            .eq('bucket', new Date(bucketTime).toISOString())
            .limit(1);

        if (rows && rows.length > 0) {
            const row = rows[0];
            return {
                timestamp: new Date(row.bucket).getTime(),
                open: Number(row.open),
                high: Number(row.high),
                low: Number(row.low),
                close: Number(row.close),
                volume: Number(row.volume)
            };
        }
        return null;
    }

    /**
     * Subscribe to real-time data
     */
    subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
        const channelId = `chart_${symbol.ticker}_${Date.now()}`;

        const channel = supabase
            .channel(channelId)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'funding_rates', filter: `asset_symbol=eq.${symbol.ticker}` },
                (payload) => {
                    const newRow = payload.new as any;
                    const rawTime = new Date(newRow.timestamp).getTime();

                    // Snap timestamp to 5-minute bucket (same logic as SQL view)
                    // 5 minutes = 300000 ms
                    const bucket = Math.floor(rawTime / 300000) * 300000;

                    const val = Number(newRow.median_apr ?? 0);

                    // We construct a "candle" from this single point.
                    // The Chart library (KlineCharts) usually handles updates:
                    // If the timestamp matches the last candle, it updates it.
                    // However, we need to send a full KLineData object. 
                    // Since we don't have the previous Open/High/Low state here easily,
                    // we might overwrite the High/Low if we just send O=H=L=C=val.

                    // BETTER APPROACH:
                    // For real-time updates on a "view", reliable aggregation is hard client-side without state.
                    // BUT, to fix the "flat line" issue where every 30s is a new candle:
                    // We must ensure the timestamp we send is `bucket`, NOT `rawTime`.

                    const kLineData: KLineData = {
                        timestamp: bucket,
                        open: val,  // In a perfect world we'd preserve the original Open
                        high: val,  // This will be updated by chart if we send it right? 
                        // Actually klinecharts `updateData` replaces the last candle if timestamp matches.
                        // So we need to fetch the current candle state or maintain it.
                        low: val,
                        close: val,
                        volume: 0 // skewing volume with random data is bad
                    };

                    // ISSUE: If we send this, it might reset the High/Low of the running candle to `val`.
                    // To do this correctly without managing state, we should fetch the latest 5m candle 
                    // from the DB view again for this bucket.

                    this.fetchSingleCandle(symbol, bucket).then(candle => {
                        if (candle) {
                            callback(candle);
                        }
                    });
                }
            )
            .subscribe();

        this.subscribers.set(`${symbol.ticker}_${period.text}`, { callback, channel });
    }

    /**
     * Unsubscribe
     */
    unsubscribe(symbol: SymbolInfo, period: Period): void {
        const key = `${symbol.ticker}_${period.text}`;
        const sub = this.subscribers.get(key);
        if (sub) {
            supabase.removeChannel(sub.channel);
            this.subscribers.delete(key);
        }
    }
}
